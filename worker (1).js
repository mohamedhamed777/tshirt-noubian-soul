const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization"};
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json",...CORS}});

// Constant-time string compare (avoids leaking token length/content via timing).
function timingSafeEqual(a,b){
 if(typeof a!=="string"||typeof b!=="string")return false;
 const enc=new TextEncoder();const A=enc.encode(a),B=enc.encode(b);
 if(A.length!==B.length)return false;
 let diff=0;for(let i=0;i<A.length;i++)diff|=A[i]^B[i];
 return diff===0;
}

function isAuthed(req,env){
 if(!env.ADMIN_TOKEN)return false; // fail closed if the secret was never set
 const h=req.headers.get("Authorization")||"";
 const m=h.match(/^Bearer\s+(.+)$/i);
 if(!m)return false;
 return timingSafeEqual(m[1],env.ADMIN_TOKEN);
}

function requireAuth(req,env){
 if(!isAuthed(req,env))return json({error:"غير مصرح. يرجى تسجيل الدخول كأدمن."},401);
 return null;
}

export default{async fetch(req,env){
 if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
 const u=new URL(req.url);
 try{
  if(u.pathname==="/"||u.pathname==="/index.html")return new Response(await env.ASSETS.fetch(new Request(new URL("/index.html",u))),{headers:{"content-type":"text/html;charset=UTF-8"}});

  // --- Public: browse products (customer-facing) ---
  if(u.pathname==="/api/products"&&req.method==="GET"){
   const {results}=await env.DB.prepare("SELECT p.*, (SELECT GROUP_CONCAT(DISTINCT color) FROM variants v WHERE v.product_id=p.id) colors, (SELECT GROUP_CONCAT(DISTINCT size) FROM variants v WHERE v.product_id=p.id) sizes FROM products p WHERE p.active=1 ORDER BY p.featured DESC,p.id DESC").all();return json(results)
  }

  // --- Admin-only: manage products ---
  if(u.pathname==="/api/products"&&req.method==="POST"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const b=await req.json();if(!b.name||!b.price)return json({error:"اسم المنتج والسعر مطلوبان"},400);
   const slug=(b.slug||b.name).toLowerCase().trim().replace(/[^a-z0-9\u0600-\u06ff]+/g,"-").replace(/^-|-$/g,"")+"-"+Date.now();
   const r=await env.DB.prepare("INSERT INTO products(name,slug,description,price,compare_price,category,featured,active,image_url) VALUES(?,?,?,?,?,?,?,?,?)").bind(b.name,slug,b.description||"",+b.price,b.compare_price?+b.compare_price:null,b.category||"T-Shirts",b.featured?1:0,b.image_url||"").run();
   return json({id:r.meta.last_row_id},201)
  }
  if(u.pathname.startsWith("/api/products/")&&req.method==="DELETE"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const id=u.pathname.split("/").pop();await env.DB.prepare("UPDATE products SET active=0 WHERE id=?").bind(id).run();return json({ok:true})
  }

  // --- Admin-only: variants ---
  if(u.pathname==="/api/variants"&&req.method==="GET"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const pid=u.searchParams.get("product_id");const q=pid?"SELECT * FROM variants WHERE product_id=?":"SELECT * FROM variants";const r=pid?await env.DB.prepare(q).bind(pid).all():await env.DB.prepare(q).all();return json(r.results)
  }
  if(u.pathname==="/api/variants"&&req.method==="POST"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const b=await req.json();if(!b.product_id||!b.color||!b.size)return json({error:"product_id/color/size required"},400);const sku=b.sku||`NS-${b.product_id}-${b.color}-${b.size}`;await env.DB.prepare("INSERT INTO variants(product_id,color,size,sku,stock) VALUES(?,?,?,?,?)").bind(b.product_id,b.color,b.size,sku,+b.stock||0).run();return json({ok:true},201)
  }
  if(u.pathname.startsWith("/api/variants/")&&req.method==="PUT"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const id=u.pathname.split("/").pop(),b=await req.json();await env.DB.prepare("UPDATE variants SET color=COALESCE(?,color),size=COALESCE(?,size),stock=COALESCE(?,stock) WHERE id=?").bind(b.color??null,b.size??null,b.stock??null,id).run();return json({ok:true})
  }
  if(u.pathname.startsWith("/api/variants/")&&req.method==="DELETE"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   await env.DB.prepare("DELETE FROM variants WHERE id=?").bind(u.pathname.split("/").pop()).run();return json({ok:true})
  }

  // --- Admin-only: image upload ---
  if(u.pathname==="/api/uploads"&&req.method==="POST"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const fd=await req.formData(),file=fd.get("image");if(!file||typeof file==="string")return json({error:"image is required"},400);
   if(!/^image\//.test(file.type||""))return json({error:"الملف لازم يكون صورة"},400);
   if(file.size>5*1024*1024)return json({error:"أقصى حجم للصورة 5MB"},400);
   const ext=(file.name.split(".").pop()||"jpg").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();const key=`products/${crypto.randomUUID()}.${ext}`;
   await env.PRODUCT_IMAGES.put(key,file.stream(),{httpMetadata:{contentType:file.type||"image/jpeg"}});
   const publicBase=env.R2_PUBLIC_BASE_URL||"";return json({key,url:publicBase?`${publicBase.replace(/\/$/,"")}/${key}`:`/media/${key}`},201)
  }
  if(u.pathname.startsWith("/media/")&&req.method==="GET"){const key=u.pathname.slice(7),obj=await env.PRODUCT_IMAGES.get(key);if(!obj)return new Response("Not found",{status:404});return new Response(obj.body,{headers:{"content-type":obj.httpMetadata?.contentType||"image/jpeg","cache-control":"public,max-age=31536000"}})}

  // --- Public: place an order (customer-facing) ---
  if(u.pathname==="/api/orders"&&req.method==="POST"){
   const b=await req.json();if(!b.customer_name||!b.phone||!b.city||!b.address||!b.items?.length)return json({error:"بيانات الطلب ناقصة"},400);
   const subtotal=b.items.reduce((s,i)=>s+(+i.price)*(+i.quantity),0),shipping=+b.shipping||60,total=subtotal+shipping;
   const o=await env.DB.prepare("INSERT INTO orders(customer_name,phone,city,address,notes,subtotal,shipping,total,payment_method) VALUES(?,?,?,?,?,?,?,?,?)").bind(b.customer_name,b.phone,b.city,b.address,b.notes||"",subtotal,shipping,total,b.payment_method||"cod").run();
   for(const i of b.items)await env.DB.prepare("INSERT INTO order_items(order_id,product_id,variant_id,quantity,price) VALUES(?,?,?,?,?)").bind(o.meta.last_row_id,i.product_id,i.variant_id||null,+i.quantity,+i.price).run();
   return json({order_id:o.meta.last_row_id,total},201)
  }

  // --- Admin-only: view all orders (contains customer PII) ---
  if(u.pathname==="/api/orders"&&req.method==="GET"){
   const authErr=requireAuth(req,env);if(authErr)return authErr;
   const r=await env.DB.prepare("SELECT * FROM orders ORDER BY id DESC").all();return json(r.results)
  }

  // --- Admin login check: front-end calls this to verify a password attempt ---
  if(u.pathname==="/api/admin/login"&&req.method==="POST"){
   const b=await req.json().catch(()=>({}));
   if(!env.ADMIN_TOKEN)return json({error:"لم يتم إعداد كلمة مرور الأدمن على السيرفر بعد."},500);
   if(!timingSafeEqual(b.password||"",env.ADMIN_TOKEN))return json({error:"كلمة المرور غير صحيحة"},401);
   return json({ok:true})
  }

  return new Response("NUBIAN SOUL",{headers:CORS})
 }catch(e){return json({error:e.message},500)}
}}
