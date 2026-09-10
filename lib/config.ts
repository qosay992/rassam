// ===== رسّام: الإعدادات والأنماط العربية =====

export type Provider = "cloudflare" | "pollinations" | "demo";

export const APP_NAME = "رسّام";
export const APP_TAGLINE = "استوديو عربي لتوليد الصور بالذكاء الاصطناعي";

export function getProvider(): Provider {
  if (process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) return "cloudflare";
  if (process.env.POLLINATIONS_ENABLED === "false") return "demo";
  return "pollinations";
}

// ===== حدود الاستخدام (طبقة مجانية آمنة) =====
export const LIMITS = {
  perUserPerDay: 25,       // صورة لكل مستخدم يومياً
  minIntervalMs: 3000,     // فاصل أدنى بين الطلبات (مانع الإغراق)
  promptMax: 2048,
};

// ===== الأنماط العربية (style presets) =====
export interface StylePreset {
  id: string;
  name: string;      // الاسم المعروض
  suffix: string;    // يُلحق بالبرومبت
}

export const STYLES: StylePreset[] = [
  { id: "auto", name: "تلقائي", suffix: "" },
  { id: "real", name: "واقعي فوتوغرافي", suffix: "ultra realistic photograph, professional photography, sharp focus, high detail, natural lighting" },
  { id: "cine", name: "سينمائي", suffix: "cinematic still, dramatic lighting, film grain, movie scene, anamorphic, depth of field" },
  { id: "anime", name: "أنمي", suffix: "anime style, studio anime art, vibrant colors, clean line art, detailed illustration" },
  { id: "draw", name: "رسم زيتي", suffix: "oil painting, classical painting, brush strokes, canvas texture, rich colors, fine art" },
  { id: "a3d", name: "ثري دي", suffix: "3d render, octane render, blender style, soft studio lighting, high quality CGI" },
  { id: "arab", name: "هوية عربية", suffix: "traditional Levantine and Arabian aesthetics, Damascene architecture, arabesque geometric patterns, islamic art motifs, warm oriental colors" },
  { id: "adv", name: "إعلان تجاري", suffix: "professional advertising photo, product shot, studio lighting, clean background, commercial quality" },
  { id: "water", name: "ألوان مائية", suffix: "watercolor painting, soft washes of color, artistic, paper texture, delicate" },
  { id: "pixel", name: "بكسل آرت", suffix: "pixel art, 16-bit retro game style, crisp pixels" },
];

// ===== الأحجام =====
export interface SizePreset { id: string; name: string; w: number; h: number; }

export const SIZES: SizePreset[] = [
  { id: "sq", name: "مربع ١:١", w: 1024, h: 1024 },
  { id: "land", name: "أفقي ١٦:٩", w: 1216, h: 704 },
  { id: "port", name: "عمودي ٩:١٦", w: 704, h: 1216 },
  { id: "four", name: "أفقي ٤:٣", w: 1152, h: 864 },
  { id: "three", name: "عمودي ٣:٤", w: 864, h: 1152 },
];

export function findSize(id: string): SizePreset {
  return SIZES.find(s => s.id === id) || SIZES[0];
}

// ===== أفكار جاهزة مصنّفة =====
export interface Idea { text: string; cat: string; }

export const IDEA_CATS = ["الكل", "مدن وتراث", "طبيعة", "أشخاص", "طعام", "خيالي"];

export const IDEAS: Idea[] = [
  { cat: "مدن وتراث", text: "سوق الحميدية بدمشق بضوء النهار المتسلل من السقف المعدني، أجواء تسعينات" },
  { cat: "مدن وتراث", text: "جدارية حلب القديمة بأزقتها الحجرية وقت الغروب، إضاءة ذهبية" },
  { cat: "مدن وتراث", text: "مسجد الأمويين من الداخل بتفاصيل الفسيفساء الذهبية، لقطة سينمائية" },
  { cat: "مدن وتراث", text: "قلعة حلب ليلاً تحت نجوم صافية، تصوير ليلي طويل التعريض" },
  { cat: "مدن وتراث", text: "بازار عثماني بمصابيح نحاسية معلقة وضباب خفيف" },
  { cat: "طبيعة", text: "مخيم نجم تحت سماء بادية تدمر، درب التبانة، تصوير ليلي" },
  { cat: "طبيعة", text: "خيول عربية أصيلة تعدو في البادية عند الفجر، غبار ذهبي" },
  { cat: "طبيعة", text: "غوطة دمشق: بساتين وورد دمشقي بعد المطر، ألوان مائية" },
  { cat: "طبيعة", text: "شاطئ اللاذقية وقت العاصفة، أمواج عالية وسماء درامية" },
  { cat: "طبيعة", text: "جبل الشيخ مغطى بالثلج مع شروق شمس وردية" },
  { cat: "أشخاص", text: "بائع كتب شارع في دمشق القديمة، أسلوب وثائقي بالأبيض والأسود" },
  { cat: "أشخاص", text: "شيخ مسن يقرأ كتاباً بضوء شمعة، عمق ميداني ضحل" },
  { cat: "أشخاص", text: "مصممة أزياء عربية تعرض تصميماً مستوحى من التراث على منصة عرض" },
  { cat: "أشخاص", text: "شاب عربي يرتدي بدلة أنيقة أمام عمارة حديثة، بورتريه سينمائي" },
  { cat: "أشخاص", text: "عازف عود في مقهى شعبي بإضاءة دافئة، أجواء حميمية" },
  { cat: "طعام", text: "طبق منسف على مائدة خشبية، تصوير طعام احترافي بإضاءة طبيعية" },
  { cat: "طعام", text: "قهوة مختصة تُصب في فنجان خشبي، خلفية مقهى دمشقي" },
  { cat: "طعام", text: "مشاوي مشكلة على فحم متوهج مع دخان، لقطة قريبة شهية" },
  { cat: "طعام", text: "كنافة نابلسية بالجبن تُقطع وتُسقى بالقطر، تصوير إعلاني" },
  { cat: "خيالي", text: "حوت يطير فوق مدينة دمشق التاريخية، أسلوب سريالي" },
  { cat: "خيالي", text: "مدينة عربية مستقبلية بأبراج زجاجية ونخيل ضخم، غروب بنفسجي" },
  { cat: "خيالي", text: "مكتبة عائمة بين السحاب بكتب تطير حولها، أسلوب خيالي ملحمي" },
  { cat: "خيالي", text: "فارس عربي على حصان أسطوري أمام بوابة مدينة رملية عملاقة" },
];

// ===== قائمة كلمات محظورة (أمن المحتوى) — عربية وإنجليزية =====
export const BLOCKED_PATTERNS: RegExp[] = [
  /\b(child|minor|underage|infant|toddler|preteen|kid|kids|boy|boys|girl|girls)\b/i,
  /\b(طفل|أطفال|اطفال|صبي|رضيع|قاصر|قاصرة)\b/i,
  /nsfw|nude|naked|porn|erotic|xxx|hentai|\bnudes?\b/i,
  /\b(عاري|عارية|إباحي|اباحي|ممنوع)\b/i,
  /gore|behead|disembowel|mutilat|corpse|\bblood\s?bath\b/i,
  /\b(isis|daesh|داعش)\b/i,
  /terroris|extremis|jihadist/i,
];
