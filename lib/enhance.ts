// ===== تحسين البرومبت العربي =====
// 1) LLM على Cloudflare Workers AI (llama-3.3-70b) لترجمة وتوسيع الوصف العربي → برومبت إنجليزي غني
//    (يُستخدم تلقائياً عند توفر مفاتيح Cloudflare — من نفس الحصة المجانية)
// 2) تراجع آلي للمحسّن المحلي عند أي فشل (الكلمات الدلالية + وسوم النمط)

const QUALITY = "highly detailed, masterpiece, best quality";

const CF_LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM_PROMPT = `You are an expert prompt engineer for the FLUX text-to-image model. The user writes a description in Arabic (sometimes English or mixed). Convert it into ONE English image-generation prompt. Rules: include every concrete subject and detail the user asked for, faithfully; enrich with concise visual language (lighting, mood, composition, camera angle, materials, colors) that strengthens the user's intent; NEVER invent new main subjects; keep it one single line, no explanations, no surrounding quotes, max 850 characters. If the user asks for Arabic text written inside the image, keep that exact Arabic text in double quotes inside the prompt and add arabic calligraphy style cues.`;

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

// ---------- LLM عبر Cloudflare Workers AI ----------
async function cfLlmEnhance(promptAr: string): Promise<string | null> {
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: promptAr },
        ],
        max_tokens: 500,
        raw: false,
      }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) return null;
  const j: any = await res.json();
  if (!j?.success) return null;

  // llama-3.3 يعيد الإجابة في choices[0].message.content
  let out: string | null = null;
  const msg = j?.result?.choices?.[0]?.message;
  if (typeof msg?.content === "string") {
    out = msg.content;
  } else if (typeof j?.result?.response === "string") {
    out = j.result.response;
  }

  if (!out || out.trim().length < 5) return null;
  out = out.replace(/\s+/g, " ").trim().replace(/^["']+|["']+$/g, "");
  if (out.length < 5) return null;
  if (out.length > 850) out = out.slice(0, 850);
  return out;
}

export interface EnhanceResult {
  prompt: string;       // البرومبت النهائي المُرسل للنموذج
  enhancedBy: "llm" | "local";
}

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
        base = await cfLlmEnhance(promptAr);
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
