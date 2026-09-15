// نقطة دخول التطبيق الحقيقية — بتتحمّل قبل أي حاجة تانية خالص، حتى قبل
// expo-router نفسه. راجع "main" فى package.json.
//
// ↔ ملحوظة حرجة عن ليه الملف ده require() مش import: عبارات import فى
// جافاسكريبت/تايبسكريبت بيتم "رفعها" (hoisted) لأعلى الملف تلقائيًا فى
// وقت التحويل (Babel) بغض النظر عن ترتيبها فى الكود — يعني لو كتبنا الملف
// ده بـ import عادي، هيتحول لـ require() فعلي، لكن كل الـ require بتاعت
// الـ imports هتتنفذ الأول (بنفس ترتيبها هي مع بعض) *قبل* أي كود تانى فى
// الملف، حتى لو كتبناها فى النص. ده بالظبط كان هيبوّظ الهدف من الملف ده:
// لازم ترقيع DOMException يحصل، وبعدين registerGlobals()، *قبل* ما
// "expo-router/entry" يتحمّل — مش العكس. require() العادية (زي تحت)
// بتتنفذ فى مكانها بالظبط، بالترتيب اللي مكتوبة بيه، فمفيش أي مفاجآت.
//
// ١) ترقيع DOMException لـ Hermes — منقول من app/_layout.tsx القديم.
// livekit-client بيرجع DOMException فى أكتر من ١٧ مكان جواه (عبر كود
// webrtc-adapter المدمج فيه)، وHermes مفيهوش DOMException كـ global
// أصلًا. لو أي كود بيستخدم livekit-client اتحمّل قبل الترقيع ده، هيحصل
// كراش فورى "Property 'DOMException' doesn't exist" (LiveKit GitHub
// issue #337). لازم الترقيع ده يسبق registerGlobals() تحت.
if (typeof global.DOMException === "undefined") {
  const DOMExceptionPolyfill = function (message, name) {
    this.message = message || "";
    this.name = name || "DOMException";
  };
  DOMExceptionPolyfill.prototype = Object.create(Error.prototype);
  DOMExceptionPolyfill.prototype.constructor = DOMExceptionPolyfill;

  Object.defineProperty(globalThis, "DOMException", {
    value: DOMExceptionPolyfill,
    writable: true,
    configurable: true,
  });
}

// ٢) تسجيل WebRTC globals بتاعة LiveKit — لازم يحصل *قبل* ما
// "expo-router/entry" يتحمّل تحت، مش بعده (لازم كمان يسبق أي شاشة أو
// مكوّن ممكن يستورد livekit-client بشكل مباشر أو غير مباشر). توثيق
// LiveKit الرسمي وكل أمثلتها مع Expo Router بتنص إن registerGlobals()
// "لازم تتنادى قبل ما الـ router أو الـ root component يتحملوا خالص".
//
// قبل كده كان الاستدعاء ده فى app/_layout.tsx — لكن package.json كان
// فيه "main": "expo-router/entry" مباشرة، يعني الراوتر نفسه (وكل حاجة
// بيحمّلها قبل ما يوصل لـ _layout.tsx) كان بيتحمّل *الأول*. ده كان
// سبب استمرار نفس الكراش المشاهَد فى الأجهزة الحقيقية رغم نقل
// registerGlobals() لـ _layout.tsx:
//   "[LiveKit] webrtcRegisterGlobals() threw: Requiring unknown module 'undefined'"
//   ثم لاحقًا: "TypeError: Cannot read property 'prototype' of undefined"
// عند محاولة الاتصال بالغرفة — وهو تحديدًا اللي كان بيمنع الـ engine من
// الوصول لحالة "connected" ويسبب فشل تبديل الكاميرا/الميكروفون.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerGlobals } = require("./lib/livekit-platform");

try {
  registerGlobals();
} catch (e) {
  console.warn("[LiveKit] registerGlobals() failed at true app entry (index.js):", e);
}

// ٣) دلوقتي بس نسيب المجال لـ expo-router يبدأ شغله — بعد ما كل
// التسجيلات الحرجة فوق خلصت فعليًا.
require("expo-router/entry");
