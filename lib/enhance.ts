// ===== تحسين البرومبت العربي =====
// توليد: LLM (llama-3.3-70b على Cloudflare) يترجم ويثري الوصف العربي → برومبت إنجليزي غني
// تحرير: تعليمات مخصصة تُلزم النموذج بالحفاظ على موضوع الصورة المرفوعة —
//        بدونها يولّد النموذج مشهداً جديداً من الصفر بدل تحرير صورة المستخدم

const QUALITY = "highly detailed, masterpiece, best quality";

const CF_LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = `You are an expert prompt engineer for the FLUX text-to-image model. The user writes a description in Arabic (sometimes English or mixed). Convert it into ONE English image-generation prompt. Rules: include every concrete subject and detail the user asked for, faithfully; enrich with concise visual language (lighting, mood, composition, camera angle, materials, colors) that strengthens the user's intent; NEVER invent new main subjects; keep it one single line, no explanations, no surrounding quotes, max 850 characters. If the user asks for Arabic text written inside the image, keep that exact Arabic text in double quotes inside the prompt and add arabic calligraphy style cues.`;

// نظام تعليمات تحرير الصور — الحفاظ على الموضوع هو القاعدة الأولى
const EDIT_SYSTEM_PROMPT = `You write editing instructions for the FLUX.2 image editing model, which receives the user's photo plus your instruction and must edit that exact photo. The user gives an edit command in Arabic. Output ONE English editing instruction that ALWAYS follows this order: (1) state the requested change; (2) an explicit preservation command: "keep the main subject of the photo exactly the same — same face, same identity, same expression, same pose, same clothing, same position and size in the frame, completely unchanged"; (3) state that only the requested part changes, with natural edge blending and consistent lighting and shadows. NEVER describe a standalone scene. NEVER omit the preservation command. One single line, max 500 characters, no quotes, no explanations, no lists.`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// كلمات دلالية عربية → وسوم إنجليزية (للمحسّن المحلي الاحتياطي)
const HINTS: [RegExp, string][] = [
  [/دمشق|الشام|سوريا/, "Damascus Syria, Levantine architecture, old city"],
  [/حلب/, "Aleppo old city, stone alleys"],
  [/تدمر|بادية/, "Palmyra desert, ancient ruins, golden sand"],
  [/لاذقية|الساحل|شاطئ/, "Latakia Mediterranean coast"],
  [/زخرفة|أرابيسك|تراثي/, "arabesque geometric patterns, islamic art"],
  [/قهوة/, "arabic coffee, traditional"],
  [/(عرس|زفاف)/, "arabic wedding celebration, festive lights"],
];

function localCore(promptAr: string): string {
  let p = promptAr.trim();
  if (p.length > 1200) p = p.slice(0, 1200);

  const tags: string[] = [];
  for (const [re, tag] of HINTS) if (re.test(p)) tags.push(tag);

  if (/اكتب|نص مكتوب|بالحروف العربية|خط عربي/.test(p)) {
    tags.push("arabic calligraphy, elegant arabic typography");
  }

  return [p, tags.join(", ")].filter(Boolean).join(", ");
}

// ---------- استدعاء عام لـ LLM على Cloudflare ----------
async function cfLlmChat(system: string, user: string, maxTokens: number): Promise<string | null> {
  const acc = process.env.CF_ACCOUNT_ID;
  const tok = process.env.CF_API_TOKEN;
  if (!acc || !tok) return null;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${CF_LLM_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) return null;
  const j: any = await res.json();
  if (!j?.success) return null;

  const msg = j?.result?.choices?.[0]?.message;
  let out: string | null = null;
  if (typeof msg?.content === "string") out = msg.content;
  else if (typeof j?.result?.response === "string") out = j.result.response;

  if (!out || out.trim().length < 5) return null;
  out = out.replace(/\s+/g, " ").trim().replace(/^["']+|["']+$/g, "");
  return out;
}

export interface EnhanceResult {
  prompt: string;
  enhancedBy: "llm" | "local";
}

// ---------- تحسين برومبت التوليد ----------
export async function enhancePrompt(
  promptAr: string,
  styleSuffix: string,
  useLLM = true
): Promise<EnhanceResult> {
  let base: string | null = null;
  let by: "llm" | "local" = "local";

  if (useLLM) {
    for (let i = 0; i < 2 && !base; i++) {
      try {
        base = await cfLlmChat(SYSTEM_PROMPT, promptAr, 500);
        if (base && base.length > 850) base = base.slice(0, 850);
        if (base) by = "llm";
      } catch {
        /* تراجع للمحلي */
      }
      if (!base && i === 0) await sleep(500);
    }
  }

  if (!base) base = localCore(promptAr);

  const prompt = [base, styleSuffix, QUALITY]
    .filter(Boolean)
    .join(", ")
    .replace(/,\s*,/g, ", ")
    .slice(0, 1900);

  return { prompt, enhancedBy: by };
}

// ---------- تحسين أمر التحرير (حماية الموضوع) ----------
function localEditCore(cmdAr: string): string {
  return `Edit this photo: ${cmdAr}. Keep the main subject of the photo exactly the same — same face, same identity, same expression, same pose, same clothing, same position and size in the frame, completely unchanged. Only apply the requested change to the rest of the image, with natural edge blending and consistent lighting.`;
}

export async function enhanceEditPrompt(
  cmdAr: string,
  useLLM = true
): Promise<EnhanceResult> {
  let base: string | null = null;
  let by: "llm" | "local" = "local";

  if (useLLM) {
    for (let i = 0; i < 2 && !base; i++) {
      try {
        base = await cfLlmChat(EDIT_SYSTEM_PROMPT, cmdAr, 400);
        if (base) by = "llm";
      } catch {
        /* تراجع للمحلي */
      }
      if (!base && i === 0) await sleep(500);
    }
  }

  if (!base) base = localEditCore(cmdAr);

  return { prompt: base.replace(/\s+/g, " ").trim().slice(0, 900), enhancedBy: by };
}
