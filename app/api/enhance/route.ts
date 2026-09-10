import { NextRequest, NextResponse } from "next/server";
import { STYLES } from "@/lib/config";
import { enhancePrompt } from "@/lib/enhance";
import { screenPrompt } from "@/lib/safety";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, msg: "طلب غير صالح" }, { status: 400 });
  }
  const promptRaw = String(body.prompt ?? "").trim();
  const styleId = String(body.style ?? "auto");
  if (!promptRaw) return NextResponse.json({ ok: false, msg: "لا يوجد وصف" }, { status: 400 });

  const safety = screenPrompt(promptRaw);
  if (!safety.ok) return NextResponse.json({ ok: false, msg: safety.reason }, { status: 422 });

  const style = STYLES.find(s => s.id === styleId) || STYLES[0];
  const { prompt, enhancedBy } = await enhancePrompt(promptRaw, style.suffix);
  return NextResponse.json({ ok: true, prompt, enhancedBy });
}
