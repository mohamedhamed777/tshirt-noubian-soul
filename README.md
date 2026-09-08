# NUBIAN SOUL Store
Cloudflare Workers + D1 + R2.

- `public/index.html`: متجر كامل في ملف واحد للواجهة.
- `src/worker.js`: API للمنتجات والـ Variants والطلبات ورفع الصور.
- `/api/uploads`: رفع صور المنتجات إلى R2.
- `/api/variants`: GET/POST/PUT/DELETE لإدارة المقاسات والألوان والمخزون.
- لا يوجد Coupon.
- WhatsApp/Vodafone Cash: 01018801708
- Email: nubiansoultshirts@gmail.com

قبل النشر: ضع D1 database_id في wrangler.toml، وأنشئ R2، ونفذ schema.sql.
يجب حماية لوحة الإدارة بمصادقة قبل الاستخدام التجاري، وربط Vodafone Cash عبر مزود دفع/merchant credentials وwebhook حقيقي.
