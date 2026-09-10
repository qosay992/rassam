// ===== الحدود اليومية + مانع الإغراق (بدون قاعدة بيانات) =====
// بسيطة للطبقة التجريبية؛ عند التحوّل للمدفوع تُستبدل بجدول في Supabase

export const FPCookie = "rassam_fp";

const counters = new Map<string, { day: string; n: number }>();
const lastAt = new Map<string, number>();

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function current(fp: string): { day: string; n: number } {
  let c = counters.get(fp);
  if (!c || c.day !== today()) {
    c = { day: today(), n: 0 };
    counters.set(fp, c);
  }
  return c;
}

// هل يملك المستخدم حصة متاحة؟ (الفشل لا يستهلك)
export function canGen(fp: string, limit: number): { ok: boolean; used: number; limit: number } {
  const c = current(fp);
  if (c.n >= limit) return { ok: false, used: c.n, limit };
  return { ok: true, used: c.n, limit };
}

// احتساب الاستهلاك — بعد نجاح التوليد فقط
export function commitGen(fp: string): { used: number; limit: number } {
  const c = current(fp);
  c.n++;
  return { used: c.n, limit: 25 };
}

// مانع الإغراق: فاصل أدنى بين الطلبات لكل بصمة
export function canRate(fp: string, minIntervalMs: number): boolean {
  const now = Date.now();
  const last = lastAt.get(fp) || 0;
  if (now - last < minIntervalMs) return false;
  lastAt.set(fp, now);
  return true;
}

export function peek(fp: string): { used: number; limit: number } {
  const limit = 25;
  const c = counters.get(fp);
  if (!c || c.day !== today()) return { used: 0, limit };
  return { used: c.n, limit };
}
