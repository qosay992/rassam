// ===== أمن المحتوى =====
import { BLOCKED_PATTERNS } from "./config";

export function screenPrompt(prompt: string): { ok: true } | { ok: false; reason: string } {
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(prompt)) {
      return { ok: false, reason: "الوصف يتضمن محتوى غير مسموح، عدّله وأعد المحاولة" };
    }
  }
  return { ok: true };
}
