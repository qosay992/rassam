// ===== مزوّد تحرير الصور — طبقتان =====
// الطبقة 1 (الأولى): Workers AI Binding عبر getCloudflareContext — الواجهة الوحيدة
// التي تستقبل الصور فعلياً لنماذج FLUX.2 (REST يتجاهلها — مُثبت بالتشخيص الموسع)
// الطبقة 2 (تراجع): الوصف المرئي + إعادة الإنشاء عبر REST — تعمل في كل بيئة

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getProvider } from "./config";

export interface EditParams {
  prompt: string;         // أمر التعديل الإنجليزي (من المحسّن الذكي)
  imageBase64: string;    // صورة الأساس
}

export interface EditResult {
  imageBase64: string;
  provider: string;
  finalPrompt: string;
  mode: "binding" | "vision";   // للشفافية: أي طبقة أنتجت النتيجة
  bindingDebug?: string[];      // تشخيص فشل الـ Binding (يُعرض مؤقتاً)
}

const CF_EDIT_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
const CF_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const CF_GEN_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const QUALITY = "highly detailed, masterpiece, best quality";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- الطبقة 1: Binding حقيقي ----------
async function editViaBinding(p: EditParams): Promise<string | null> {
  let ctx: any;
  try {
    ctx = await getCloudflareContext();
  } catch {
    return null; // بيئة بلا binding (dev محلي مثلاً)
  }
  const ai = ctx?.env?.AI;
  if (!ai?.run) return null;

  const bindingDebug: string[] = [];
  const bytes = new Uint8Array(Buffer.from(p.imageBase64, "base64"));

  // سلسلة صيغ: blob ملف، مصفوفة، multipart صريح — حتى تثبت الصيغة الفعالة
  const inputs: any[] = [
    {
      prompt: p.prompt,
      image: [new Blob([bytes], { type: "image/jpeg" })],
    },
    {
      prompt: p.prompt,
      image: [bytes],
    },
    {
      prompt: p.prompt,
      image: new Blob([bytes], { type: "image/jpeg" }),
    },
  ];

  for (let idx = 0; idx < inputs.length; idx++) {
    const input = inputs[idx];
    try {
      const resp: any = await ai.run(CF_EDIT_MODEL, input);
      let b64: string | null = null;
      if (typeof resp === "string" && resp.length > 100) {
        b64 = resp;
      } else if (resp instanceof Blob || resp instanceof ArrayBuffer) {
        const buf = Buffer.from(await new Response(resp).arrayBuffer());
        if (buf.length > 1000) b64 = buf.toString("base64");
      } else if (typeof resp?.image === "string" && resp.image.length > 100) {
        b64 = resp.image;
      } else if (resp instanceof ReadableStream) {
        const buf = Buffer.from(await new Response(resp).arrayBuffer());
        if (buf.length > 1000) b64 = buf.toString("base64");
      }
      if (b64) return b64;
      bindingDebug.push(`v${idx + 1}: no-image (${typeof resp})`);
    } catch (e) {
      const msg = String((e as any)?.message || e);
      bindingDebug.push(`v${idx + 1}: ${msg.slice(0, 120)}`);
      if (msg.includes("not allowed") || msg.includes("Authentication")) throw new Error("الـ Binding غير مصرح له بهذا النموذج");
    }
    await sleep(400);
  }
  (globalThis as any).__rassamBindingDebug = bindingDebug;
  return null;
}

// ---------- الطبقة 2: وصف مرئي + إعادة إنشاء (REST) ----------
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
                text: "Describe this photo in one rich English paragraph (max 120 words) as an image-generation prompt. Include: the main subject and its precise appearance, pose and expression, framing, the current background and setting, lighting and mood, and photographic style. Output only the paragraph.",
              },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          }],
          max_tokens: 300,
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) {
      if (res.status === 429) throw new Error("QUOTA_EXHAUSTED");
      return null;
    }
    const j: any = await res.json();
    let out = j?.result?.response;
    if (!out || typeof out !== "string") return null;
    out = out.replace(/\s+/g, " ").trim();
    return out.length > 20 ? out.slice(0, 900) : null;
  } catch {
    return null;
  }
}

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
      if (res.status === 429) throw new Error("نفدت الحصة السحابية اليومية مؤقتاً — تتجدد بعد منتصف الليل UTC");
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j: any = await res.json();
        if (j?.success && typeof j?.result?.image === "string" && j.result.image.length > 100) return j.result.image;
        lastErr = "بلا صورة"; continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 1000) return buf.toString("base64");
      lastErr = "صورة فارغة";
    } catch (e: any) { lastErr = String(e?.message || e).slice(0, 100); }
    if (i < attempts.length - 1) await sleep(800);
  }
  throw new Error(`تعذّر إعادة الإنشاء: ${String(lastErr).slice(0, 120)}`);
}

// ---------- المرسّى ----------
export async function editImage(p: EditParams): Promise<EditResult> {
  if (getProvider() !== "cloudflare") {
    throw new Error("تحرير الصور يتطلب تفعيل المزوّد السحابي (Cloudflare)");
  }

  // الطبقة 1: Binding — تحرير حقيقي يرى صورتك
  try {
    const b64 = await editViaBinding(p);
    if (b64) {
      return { imageBase64: b64, provider: "cloudflare/flux-2-klein-9b-binding", finalPrompt: p.prompt, mode: "binding" };
    }
  } catch (e: any) {
    // أخطاء الصلاحيات لا تسقط للطبقة الثانية بصمت — لكن نكمل: أفضل نتيجة متاحة
    console.error("binding edit failed:", e?.message);
  }

  // الطبقة 2: وصف مرئي + إعادة إنشاء
  const desc = await describeImage(p.imageBase64).catch((e: any) => {
    if (String(e?.message).includes("QUOTA_EXHAUSTED")) {
      throw new Error("نفدت الحصة السحابية اليومية مؤقتاً — تتجدد بعد منتصف الليل UTC. عد قريباً أو فعّل خطة Workers Paid");
    }
    return null;
  });
  if (!desc) throw new Error("تعذّر تحليل الصورة — جرّب صورة أوضح أو أصغر حجماً");
  const finalPrompt = `${desc}. ${p.prompt}. ${QUALITY}`.replace(/\s+/g, " ").slice(0, 1900);
  const dims = imageDims(p.imageBase64);
  const w = dims ? clampDim(dims.w) : 1024;
  const h = dims ? clampDim(dims.h) : 1024;
  const imageBase64 = await genFlux(finalPrompt, w, h);
  const dbg = (globalThis as any).__rassamBindingDebug as string[] | undefined;
  return {
    imageBase64,
    provider: "cloudflare/vision+flux",
    finalPrompt,
    mode: "vision",
    ...(dbg ? { bindingDebug: dbg } : {}),
  };
}
