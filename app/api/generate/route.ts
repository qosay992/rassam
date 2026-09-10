import { NextRequest, NextResponse } from "next/server";
import { getProvider, STYLES, findSize, LIMITS } from "@/lib/config";
import { generateImage } from "@/lib/providers";
import { enhancePrompt } from "@/lib/enhance";
import { screenPrompt } from "@/lib/safety";
import { FPCookie, canGen, commitGen, canRate } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 60;

const COOKIE_OPTS = { maxAge: 60 * 60 * 24 * 90, httpOnly: false, sameSite: "lax" as const };

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "طلب غير صالح" }, { status: 400 });
  }

  const promptRaw = String(body.prompt ?? "").trim();
  const styleId = String(body.style ?? "auto");
  const sizeId = String(body.size ?? "sq");
  const seedRaw = Number(body.seed);
  const noEnhance = body.noEnhance === true;

  if (!promptRaw) {
    return NextResponse.json({ ok: false, msg: "اكتب وصفاً للصورة أولاً" }, { status: 400 });
  }
  if (promptRaw.length > LIMITS.promptMax) {
    return NextResponse.json({ ok: false, msg: "الوصف طويل جداً" }, { status: 400 });
  }

  // فحص الأمان الأول (المدخل)
  const safety1 = screenPrompt(promptRaw);
  if (!safety1.ok) {
    return NextResponse.json({ ok: false, msg: safety1.reason }, { status: 422 });
  }

  let fp = req.cookies.get(FPCookie)?.value || "";
  if (!fp) fp = crypto.randomUUID();

  // مانع الإغراق
  if (!canRate(fp, LIMITS.minIntervalMs)) {
    return NextResponse.json(
      { ok: false, msg: "تمهل قليلاً — انتظر ثوانٍ بين طلب وآخر", retry: true },
      { status: 429 }
    );
  }

  // الحد اليومي (فحص مبدئي — الاحتساب بعد النجاح)
  const gate = canGen(fp, LIMITS.perUserPerDay);
  if (!gate.ok) {
    const res = NextResponse.json(
      { ok: false, msg: `وصلت الحد اليومي (${gate.limit} صورة). عد غداً أو فعّل المزوّد السحابي.`, used: gate.used, limit: gate.limit },
      { status: 429 }
    );
    res.cookies.set(FPCookie, fp, COOKIE_OPTS);
    return res;
  }

  const style = STYLES.find(s => s.id === styleId) || STYLES[0];
  const size = findSize(sizeId);
  const seed = Number.isFinite(seedRaw) && seedRaw > 0 ? Math.floor(seedRaw) : undefined;

  // 1) تحسين البرومبت (LLM مجاني أو محلي) — مع تعطيله عند طلب المستخدم
  const { prompt, enhancedBy } = await enhancePrompt(promptRaw, style.suffix, !noEnhance);

  // فحص الأمان الثاني (البرومبت النهائي بعد التحسين)
  const safety2 = screenPrompt(prompt);
  if (!safety2.ok) {
    return NextResponse.json({ ok: false, msg: safety2.reason }, { status: 422 });
  }

  // 2) التوليد
  try {
    const result = await generateImage({ prompt, width: size.w, height: size.h, seed });

    // نجاح → احتساب الحصة
    const q = commitGen(fp);
    const res = NextResponse.json({
      ok: true,
      image: `data:image/jpeg;base64,${result.imageBase64}`,
      seed: result.seed,
      provider: result.provider,
      enhancedBy,
      finalPrompt: prompt,
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
