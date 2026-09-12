import { NextRequest, NextResponse } from "next/server";
import { LIMITS } from "@/lib/config";
import { editImage } from "@/lib/editProvider";
import { enhanceEditPrompt } from "@/lib/enhance";
import { screenPrompt, screenEditPrompt } from "@/lib/safety";
import { FPCookie, canGen, commitGen, canRate } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 60;

const COOKIE_OPTS = { maxAge: 60 * 60 * 24 * 90, httpOnly: false, sameSite: "lax" as const };
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6MB صورة الأساس

function stripDataUrl(s: string): string {
  return s.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "طلب غير صالح" }, { status: 400 });
  }

  const cmdRaw = String(body.prompt ?? "").trim();
  const imageRaw = String(body.image ?? "");
  const noEnhance = body.noEnhance === true;

  if (!cmdRaw) {
    return NextResponse.json({ ok: false, msg: "اكتب أمر التعديل المطلوب" }, { status: 400 });
  }
  if (cmdRaw.length > LIMITS.promptMax) {
    return NextResponse.json({ ok: false, msg: "أمر التعديل طويل جداً" }, { status: 400 });
  }
  if (!imageRaw) {
    return NextResponse.json({ ok: false, msg: "ارفع صورة للتعديل أولاً" }, { status: 400 });
  }

  const imageBase64 = stripDataUrl(imageRaw);
  if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, msg: "حجم الصورة كبير جداً (الحد 6MB)" }, { status: 413 });
  }

  // فحص أمان أمر التعديل
  const safety = screenPrompt(cmdRaw);
  if (!safety.ok) {
    return NextResponse.json({ ok: false, msg: safety.reason }, { status: 422 });
  }

  let fp = req.cookies.get(FPCookie)?.value || "";
  if (!fp) fp = crypto.randomUUID();

  if (!canRate(fp, LIMITS.minIntervalMs)) {
    return NextResponse.json(
      { ok: false, msg: "تمهل قليلاً — انتظر ثوانٍ بين طلب وآخر", retry: true },
      { status: 429 }
    );
  }

  const gate = canGen(fp, LIMITS.perUserPerDay);
  if (!gate.ok) {
    const res = NextResponse.json(
      { ok: false, msg: `وصلت الحد اليومي (${gate.limit} صورة). عد غداً.`, used: gate.used, limit: gate.limit },
      { status: 429 }
    );
    res.cookies.set(FPCookie, fp, COOKIE_OPTS);
    return res;
  }

  // تحسين أمر التعديل — تعليمات مخصصة تُلزم النموذج بالحفاظ على موضوع الصورة
  const { prompt } = await enhanceEditPrompt(cmdRaw, !noEnhance);

  const safety2 = screenEditPrompt(prompt);
  if (!safety2.ok) {
    return NextResponse.json({ ok: false, msg: safety2.reason }, { status: 422 });
  }

  try {
    const result = await editImage({ prompt, imageBase64 });
    const q = commitGen(fp);
    const res = NextResponse.json({
      ok: true,
      image: `data:image/jpeg;base64,${result.imageBase64}`,
      provider: result.provider,
      finalPrompt: result.finalPrompt,
      used: q.used,
      limit: q.limit,
    });
    res.cookies.set(FPCookie, fp, COOKIE_OPTS);
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, msg: String(e?.message || e).slice(0, 250), used: gate.used, limit: gate.limit, retry: true },
      { status: 502 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: false, msg: "استخدم POST" }, { status: 405 });
}
