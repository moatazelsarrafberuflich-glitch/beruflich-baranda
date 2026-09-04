#!/usr/bin/env bash
# =============================================================================
# Diarino — أوامر نشر Production مجمَّعة، جاهزة للنسخ والتنفيذ بالترتيب.
#
# هذا الملف مرجعي (لا يُشغَّل تلقائيًا كسكربت واحد) — لأن عدة خطوات تتطلب
# قيمًا حقيقية منكم (مفاتيح، بصمات SHA-1) وخطوات يدوية عبر لوحات تحكم
# لا يوجد لها أمر CLI. الشرح الكامل لكل خطوة في docs/deployment-guide.md —
# هذا الملف هو الأوامر فقط، بلا شرح، للنسخ السريع.
#
# لا تُشغّلوا هذا الملف بالكامل دفعة واحدة (bash deploy-commands.sh) —
# نفّذوا كل قسم يدويًا بعد التأكد من اكتمال ما قبله.
# =============================================================================

set -euo pipefail  # فقط لو اخترتم تشغيل قسم كسكربت فعلي — يوقف عند أول خطأ

# -----------------------------------------------------------------------
# 0. مفتاح Google Maps API (Android) — قبل أي شيء آخر، قبل eas build تحديدًا
#    تفصيل كامل: docs/deployment-guide.md القسم ٠
# -----------------------------------------------------------------------

# 0.1 — بصمة SHA-1 لمفتاح الرفع (متاحة فورًا، قبل أي نشر)
eas credentials
# اختاروا: Android → production → Keystore: Manage everything needed to build your project

# 0.2 — يدويًا: أنشئوا/قيّدوا مفتاح Maps API في Google Cloud Console
#   - فعّلوا "Maps SDK for Android" فقط
#   - قيّدوا بـ package name: com.diarino.app + بصمة SHA-1 من 0.1

# 0.3 — يدويًا: عدّلوا app.json
#   android.config.googleMaps.apiKey = "<قيمتكم الحقيقية>"
#   ⚠️ يجب ألا تبقى القيمة REPLACE_WITH_YOUR_ANDROID_MAPS_API_KEY قبل المتابعة لقسم 5 أدناه

# -----------------------------------------------------------------------
# 1. الربط بمشروع Supabase الإنتاج
# -----------------------------------------------------------------------
supabase login
supabase projects list                                  # تأكدوا من الـ ref قبل الربط
supabase link --project-ref nwbtzchtwyhqktoerbap

# -----------------------------------------------------------------------
# 2. نسخة احتياطية يدوية قبل أي migration
#    (عبر Supabase Dashboard → Database → Backups → Create backup now)
#    أو محليًا:
# -----------------------------------------------------------------------
# pg_dump "postgresql://postgres:<password>@db.nwbtzchtwyhqktoerbap.supabase.co:5432/postgres" \
#   > backup_$(date +%Y%m%d_%H%M%S).sql

# -----------------------------------------------------------------------
# 3. Migrations
# -----------------------------------------------------------------------
supabase migration list                                  # تأكدوا من عدم وجود تعارض قبل push
supabase db push

# تحقّق فوري بعد db push (عبر SQL Editor أو psql):
#   select * from public.profiles_public limit 1;
#   select public.is_admin();
#   select * from public.live_message_rate_buckets limit 1;

# -----------------------------------------------------------------------
# 4. Secrets للـ Edge Functions (سيرفر فقط — ليست EAS، ليست app.json)
# -----------------------------------------------------------------------
supabase secrets list                                     # قبل التعديل، لمعرفة الموجود حاليًا

supabase secrets set LIVEKIT_URL=<قيمتكم>
supabase secrets set LIVEKIT_API_KEY=<قيمتكم>
supabase secrets set LIVEKIT_API_SECRET=<قيمتكم>
supabase secrets set RECORDING_S3_ACCESS_KEY=<قيمتكم>
supabase secrets set RECORDING_S3_SECRET=<قيمتكم>
supabase secrets set RECORDING_S3_ENDPOINT=<قيمتكم>
supabase secrets set RECORDING_S3_BUCKET=<قيمتكم>
supabase secrets set RECORDING_S3_REGION=<قيمتكم>        # اختياري، افتراضيًا us-east-1
supabase secrets set PUSH_WEBHOOK_SECRET=<سلسلة عشوائية طويلة تختارونها الآن>

supabase secrets list                                     # تحقّق: الأسماء التسعة كلها ظاهرة

# -----------------------------------------------------------------------
# 5. Edge Functions (6 دوال)
# -----------------------------------------------------------------------
supabase functions deploy livekit-token
supabase functions deploy livekit-recording
supabase functions deploy livekit-moderate
supabase functions deploy livekit-send-message
supabase functions deploy livekit-webhook --no-verify-jwt
supabase functions deploy send-push --no-verify-jwt

supabase functions list                                   # تحقّق: الحالة "deployed" للجميع

# -----------------------------------------------------------------------
# 6. خطوات يدوية عبر لوحات التحكم (لا أمر CLI لها)
#    تفصيل كامل: README.md وdocs/deployment-guide.md القسم ب/الخطوة 5
# -----------------------------------------------------------------------
#   - Database Webhook لـ send-push (جدول notifications، حدث Insert،
#     Header x-webhook-secret = قيمة PUSH_WEBHOOK_SECRET من قسم 4)
#   - LiveKit Cloud → Settings → Webhooks:
#     https://nwbtzchtwyhqktoerbap.supabase.co/functions/v1/livekit-webhook
#   - Cloudinary: upload preset "Diarino_uploads" مضبوط Unsigned
#   - Supabase Dashboard → Storage → S3 Connection → bucket "live-recordings"
#   - Google OAuth redirect URL: diarino://auth-callback (Supabase Dashboard
#     → Authentication → URL Configuration)
#   - Supabase Dashboard → Authentication → Sign In / Providers →
#     Anonymous Sign-Ins مفعّل (لوضع الضيف)

# -----------------------------------------------------------------------
# 7. فحوصات محلية قبل eas build
# -----------------------------------------------------------------------
npx tsc --noEmit
# تأكدوا أيضًا يدويًا: app.json's version / ios.buildNumber / android.versionCode
# محدَّثة عن آخر نسخة منشورة على المتجرين

# -----------------------------------------------------------------------
# 8. بناء التطبيق للإنتاج
#    ⚠️ فقط بعد التأكد أن app.json's googleMaps.apiKey حقيقي (قسم 0 أعلاه)
# -----------------------------------------------------------------------
eas build --platform android --profile production
eas build --platform ios --profile production

# بعد اكتمال البناء: اختبار يدوي كامل على جهاز حقيقي قبل submit —
# تسجيل دخول (Google + ضيف)، نشر إعلان، بث كامل (بدء→تعليق→طرد→إنهاء→إعادة
# مشاهدة)، شات، تسجيل خروج ثم دخول بحساب آخر (يختبر مسح الـ cache)،
# فتح شاشة البحث الجغرافي والتأكد أن الخريطة تظهر فعليًا.

# -----------------------------------------------------------------------
# 9. الإرسال للمتاجر
# -----------------------------------------------------------------------
eas submit --platform android --profile production
eas submit --platform ios --profile production

# -----------------------------------------------------------------------
# 10. بعد أول رفع ناجح لـ Play Console فقط
# -----------------------------------------------------------------------
#   Play Console → Release → Setup → App integrity →
#   انسخوا "SHA-1 certificate fingerprint" تحت App signing key certificate
#   وأضيفوه في Google Cloud Console لنفس مفتاح Maps API (بجانب بصمة قسم 0.1)
#   — لا حاجة لإعادة بناء التطبيق لهذه الخطوة، تسري خلال دقائق.

# -----------------------------------------------------------------------
# 11. أول 24 ساعة — راقبوا (تفصيل كامل: docs/deployment-guide.md القسم ه)
# -----------------------------------------------------------------------
#   - Supabase Dashboard → Logs → Edge Functions / Database
#   - Play Console → Quality → Android vitals (crashes/ANRs)
#   - App Store Connect → Analytics
#   - LiveKit Cloud dashboard → عدد الغرف/الاتصالات
#   - Cloudinary dashboard → Usage
#   - وصول push notification حقيقي واحد على الأقل لكل منصة
