// ===== مزوّد تحرير الصور: FLUX.2 [klein] 4B على Cloudflare =====
// يستقبل صورة أساس + أمر تعديل نصي → يعيد صورة محررة
// متطلب: مفاتيح Cloudflare (لا يوجد بديل مجاني موثوق للتحرير حالياً)

import { getProvider } from "./config";

export interface EditParams {
  prompt: string;        // أمر التعديل (إنجليزي بعد التحسين)
  imageBase64: string;    // صورة الأساس (بدون data: prefix)
}

export interface EditResult {
  imageBase64: string;
  provider: string;
}

const CF_EDIT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function editCloudflareOnce(p: EditParams): Promise<EditResult> {
  const acc = process.env.CF_ACCOUNT_ID!;
  const tok = process.env.CF_API_TOKEN!;

  // الموديل يستقبل multipart: prompt + image (base64)
  const fd = new FormData();
  fd.append("prompt", p.prompt);
  fd.append("image", p.imageBase64);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${CF_EDIT_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
      body: fd,
      signal: AbortSignal.timeout(150_000),
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${txt.slice(0, 140)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) {
    const j: any = await res.json();
    if (!j?.success) {
      throw new Error(j?.errors?.[0]?.message || "استجابة غير متوقعة من مزوّد التحرير");
    }
    if (typeof j?.result?.image !== "string" || j.result.image.length < 100) {
      throw new Error("المزوّد لم يُرجع صورة");
    }
    return { imageBase64: j.result.image, provider: "cloudflare/flux-2-klein" };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error("صورة فارغة من مزوّد التحرير");
  return { imageBase64: buf.toString("base64"), provider: "cloudflare/flux-2-klein" };
}

export async function editImage(p: EditParams): Promise<EditResult> {
  if (getProvider() !== "cloudflare") {
    throw new Error("تحرير الصور يتطلب تفعيل المزوّد السحابي (Cloudflare) — أضف المفاتيح في .env");
  }
  let lastErr: any = null;
  for (let i = 0; i < 2; i++) {
    if (i > 0) await sleep(1000);
    try {
      return await editCloudflareOnce(p);
    } catch (e) {
      lastErr = e;
      const msg = String((e as any)?.message);
      if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
        throw new Error("مفتاح Cloudflare مرفوض — تحقق من صلاحيات الرمز");
      }
    }
  }
  throw new Error(`تعذّر التحرير: ${String(lastErr?.message || lastErr).slice(0, 160)}`);
}
