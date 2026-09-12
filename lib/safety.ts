// ===== أمن المحتوى =====
import { BLOCKED_PATTERNS } from "./config";

// فحص كامل (للتوليد من الصفر ولأوامر المستخدم): يشمل كلمات العمر
// — توليد صور لأطفال غير مسموح إطلاقاً
export function screenPrompt(prompt: string): { ok: true } | { ok: false; reason: string } {
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(prompt)) {
      return { ok: false, reason: "الوصف يتضمن محتوى غير مسموح، عدّله وأعد المحاولة" };
    }
  }
  return { ok: true };
}

// فحص ناعم (للبرومبت النهائي للتحرير فقط): نفس المحظورات الخطرة
// دون كلمات العمر — لأن أمر الحفاظ على موضوع صورة مرفوعة
// ("keep the child / the boy exactly the same") شرعي في سياق التحرير
// بينما توليد طفل من الصفر يبقى محجوباً عبر الفحص الكامل
const SOFT_PATTERNS: RegExp[] = [
  /nsfw|nude|naked|porn|erotic|xxx|hentai/i,
  /\b(عاري|عارية|إباحي|اباحي)\b/i,
  /gore|behead|disembowel|mutilat|corpse/i,
  /\b(isis|daesh|داعش)\b/i,
  /terroris|extremis|jihadist/i,
];

export function screenEditPrompt(prompt: string): { ok: true } | { ok: false; reason: string } {
  for (const re of SOFT_PATTERNS) {
    if (re.test(prompt)) {
      return { ok: false, reason: "أمر التعديل يتضمن محتوى غير مسموح" };
    }
  }
  return { ok: true };
}
