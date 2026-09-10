// ===== مزوّدات التوليد: Cloudflare FLUX (رئيسي) + Pollinations (مجاني/تجريبي) =====

import { getProvider } from "./config";

export interface GenParams {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
}

export interface GenResult {
  imageBase64: string; // JPEG
  provider: string;
  seed: number;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- Cloudflare Workers AI ----------
// ملاحظة: endpoint الفعلي يرفض حقول إضافية (seed) — نبني الجسم ببساطة ثم نتحقق
const CF_MODEL = "@cf/black-forest-labs/flux-1-schnell";

async function genCloudflareOnce(p: GenParams, seed: number, withSeed: boolean): Promise<GenResult> {
  const acc = process.env.CF_ACCOUNT_ID!;
  const tok = process.env.CF_API_TOKEN!;
  const payload: Record<string, unknown> = { prompt: p.prompt, steps: 4 };
  if (withSeed) payload.seed = seed;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${CF_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt.slice(0, 140)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) {
    const j: any = await res.json();
    if (!j.success) {
      const msg: string = j.errors?.[0]?.message || "استجابة غير متوقعة من Cloudflare";
      throw new Error(msg);
    }
    if (!j.result?.image) throw new Error("Cloudflare لم يُرجع صورة");
    return { imageBase64: j.result.image, provider: "cloudflare", seed };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("صورة فارغة من Cloudflare");
  return { imageBase64: buf.toString("base64"), provider: "cloudflare", seed };
}

async function genCloudflare(p: GenParams): Promise<GenResult> {
  const seed = p.seed ?? Math.floor(Math.random() * 1_000_000);
  let lastErr: any = null;
  // المحاولة 1: بدون seed (توافق أوسع) — المحاولة 2: مع seed — المحاولة 3: بدون seed بعد مهلة
  const variants = [false, true, false];
  for (let i = 0; i < variants.length; i++) {
    if (i > 0) await sleep(900 * i);
    try {
      return await genCloudflareOnce(p, seed, variants[i]);
    } catch (e) {
      lastErr = e;
      const msg = String((e as any)?.message);
      // أخطاء غير قابلة للإعادة: مصادقة أو رصيد
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
        throw new Error("مفتاح Cloudflare مرفوض (401/403) — تحقق من صلاحيات الرمز");
      }
      if (msg.includes("Authentication error") || msg.includes("not allowed")) {
        throw new Error(`صلاحية الرمز لا تسمح بالتوليد — أنشئه بصلاحية Workers AI`);
      }
    }
  }
  throw new Error(`فشل التوليد السحابي: ${String(lastErr?.message || lastErr).slice(0, 160)}`);
}

// ---------- Pollinations (بدون مفتاح — للتجربة المجانية) ----------
// استراتيجية: 3 محاولات — flux بالحجم الكامل، flux بحجم مصغر، ثم turbo الأسرع

async function genPollOnce(prompt: string, w: number, h: number, seed: number, model: string, timeoutMs: number): Promise<GenResult> {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 700))}` +
    `?width=${w}&height=${h}&nologo=true&seed=${seed}&model=${model}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("empty");
  return { imageBase64: buf.toString("base64"), provider: `pollinations/${model}`, seed };
}

async function genPollinations(p: GenParams): Promise<GenResult> {
  const seed = p.seed ?? Math.floor(Math.random() * 1_000_000);
  const w = Math.min(p.width, 1216), h = Math.min(p.height, 1216);
  const attempts: { model: string; w: number; h: number; t: number }[] = [
    { model: "flux", w, h, t: 150_000 },
    { model: "flux", w: Math.min(w, 1024), h: Math.min(h, 1024), t: 150_000 },
    { model: "turbo", w: Math.min(w, 1024), h: Math.min(h, 1024), t: 120_000 },
  ];

  let lastStatus = "";
  for (let i = 0; i < attempts.length; i++) {
    if (i > 0) await sleep(1200 * i);
    const a = attempts[i];
    try {
      return await genPollOnce(p.prompt, a.w, a.h, seed, a.model, a.t);
    } catch (e: any) {
      const msg = String(e?.message || e);
      const m = msg.match(/HTTP (\d{3})/);
      if (m) lastStatus = m[1];
      // 404/400 تعني مشكلة في الطلب نفسه — لا فائدة من الإعادة بنفس الشكل
      if (lastStatus === "400" || lastStatus === "404") continue;
    }
  }
  if (lastStatus === "429") {
    throw new Error("الخدمة المجانية مزدحمة الآن (429) — انتظر نصف دقيقة ثم أعد المحاولة، أو فعّل المزوّد السحابي");
  }
  if (lastStatus === "402") {
    throw new Error("انتهت حصة اليوم من الخدمة المجانية — فعّل المزوّد السحابي (Cloudflare) لاستمرار التوليد");
  }
  throw new Error(
    `تعذّر التوليد بعد ${attempts.length} محاولات${lastStatus ? ` (رمز ${lastStatus})` : ""} — الخدمة المجانية تحت ضغط، جرب بعد لحظات`
  );
}

// ---------- المرسّى ----------
// سلسلة التنازل: Cloudflare → Pollinations عند فشل السحابي (نفاد الحصة/ازدحام)
// — لا يتوقف التطبيق أبداً أثناء البيتا
export async function generateImage(p: GenParams): Promise<GenResult> {
  const provider = getProvider();

  if (provider === "cloudflare") {
    let cfErr: any = null;
    try {
      return await genCloudflare(p);
    } catch (e) {
      cfErr = e;
    }
    try {
      return await genPollinations(p);
    } catch {
      throw cfErr; // نُعيد الخطأ السحابي الأصلي لأنه الأدق تشخيصاً
    }
  }

  if (provider === "pollinations") return genPollinations(p);
  if (provider === "demo") {
    throw new Error("لا يوجد مزوّد توليد مُهيّأ (demo)");
  }
  throw new Error("مزوّد غير معروف");
}
