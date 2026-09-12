// ===== مزوّد تحرير الصور — نهج "الوصف المرئي + إعادة الإنشاء" =====
// حقيقة مُثبتة بالتشخيص: واجهة REST لدى Cloudflare لا تستقبل صوراً لأي
// نموذج صور متاح (FLUX.2 klein/dev، SDXL، dreamshaper) — تتجاهلها وتولّد نصياً
// الحل الواقعي: نموذج رؤية يصف الصورة المرفوعة بدقة (الموضوع/الوضعية/الملابس/الخلفية)
// ثم يُعاد إنشاء الصورة عبر FLUX بالوصف + أمر التعديل — النتيجة تحاكي الأصل مع التعديل

import { getProvider } from "./config";

export interface EditParams {
  prompt: string;         // أمر التعديل الإنجليزي (من المحسّن الذكي)
  imageBase64: string;    // صورة الأساس
}

export interface EditResult {
  imageBase64: string;
  provider: string;
  finalPrompt: string;   // الوصف المدمج المُرسل فعلياً
}

const CF_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const CF_GEN_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const QUALITY = "highly detailed, masterpiece, best quality";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---- أبعاد الصورة من الترويسة (PNG IHDR / JPEG SOF) بدون مكتبات ----
export function imageDims(imageBase64: string): { w: number; h: number } | null {
  const buf = Buffer.from(imageBase64, "base64");
  if (buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

function clampDim(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1024;
  return Math.max(256, Math.min(2048, Math.round(n / 64) * 64));
}

// ---- وصف الصورة عبر نموذج الرؤية — "عين" النظام على صورتك ----
async function describeImage(imageBase64: string): Promise<string | null> {
  const acc = process.env.CF_ACCOUNT_ID;
  const tok = process.env.CF_API_TOKEN;
  if (!acc || !tok) return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${CF_VISION_MODEL}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "Describe this photo in one rich English paragraph (max 120 words) as an image-generation prompt. Include: the main subject and its precise appearance (age range, gender, hair, clothing), pose and expression, framing (close-up/medium/full), the current background and setting, lighting and mood, and photographic style. Output only the paragraph.",
              },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          }],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) return null;
    const j: any = await res.json();
    let out = j?.result?.response;
    if (!out || typeof out !== "string") return null;
    out = out.replace(/\s+/g, " ").trim();
    return out.length > 20 ? out.slice(0, 900) : null;
  } catch {
    return null;
  }
}

// ---- توليد عبر FLUX مع أبعاد الصورة الأصلية وسلسلة تنازل ----
async function genFlux(prompt: string, w: number, h: number): Promise<string> {
  const acc = process.env.CF_ACCOUNT_ID!;
  const tok = process.env.CF_API_TOKEN!;
  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${CF_GEN_MODEL}`;

  const attempts = [
    { prompt, steps: 8, width: w, height: h },
    { prompt, steps: 8 },
    { prompt: prompt.slice(0, 1800), steps: 4 },
  ];

  let lastErr: any = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
        body: JSON.stringify(attempts[i]),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`;
        continue;
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j: any = await res.json();
        if (j?.success && typeof j?.result?.image === "string" && j.result.image.length > 100) {
          return j.result.image;
        }
        lastErr = "استجابة بلا صورة";
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) return buf.toString("base64");
      lastErr = "صورة فارغة";
    } catch (e: any) {
      lastErr = String(e?.message || e).slice(0, 120);
    }
    if (i < attempts.length - 1) await sleep(800);
  }
  throw new Error(`تعذّر إعادة الإنشاء: ${String(lastErr).slice(0, 140)}`);
}

export async function editImage(p: EditParams): Promise<EditResult> {
  if (getProvider() !== "cloudflare") {
    throw new Error("تحرير الصور يتطلب تفعيل المزوّد السحابي (Cloudflare) — أضف المفاتيح في .env");
  }

  // 1) وصف الصورة عبر الرؤية — بدونه لا سبيل لتمرير محتوى الصورة
  const desc = await describeImage(p.imageBase64);
  if (!desc) {
    throw new Error("تعذّر تحليل الصورة — جرّب صورة أوضح أو أصغر حجماً (حتى 2MB)");
  }

  // 2) دمج: وصف الأصل + أمر التعديل
  const finalPrompt = `${desc}. ${p.prompt}. ${QUALITY}`.replace(/\s+/g, " ").slice(0, 1900);

  // 3) أبعاد من الصورة الأصلية إن أمكن
  const dims = imageDims(p.imageBase64);
  const w = dims ? clampDim(dims.w) : 1024;
  const h = dims ? clampDim(dims.h) : 1024;

  // 4) إعادة الإنشاء عبر FLUX
  const imageBase64 = await genFlux(finalPrompt, w, h);
  return { imageBase64, provider: "cloudflare/vision+flux", finalPrompt };
}
