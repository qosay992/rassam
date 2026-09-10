import { NextRequest, NextResponse } from "next/server";
import { getProvider, STYLES, IDEA_CATS } from "@/lib/config";
import { enhancePrompt } from "@/lib/enhance";
import { screenPrompt } from "@/lib/safety";
import { peek, FPCookie } from "@/lib/quota";
import { IDEAS } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const fp = req.cookies.get(FPCookie)?.value || "";
  const q = peek(fp);
  const provider = getProvider();
  return NextResponse.json({
    ok: true,
    provider,
    providerLabel:
      provider === "cloudflare" ? "Cloudflare FLUX (سحابي)" : provider === "pollinations" ? "وضع تجريبي مجاني" : "ديمو",
    styles: STYLES.map(s => ({ id: s.id, name: s.name })),
    sizes: [
      { id: "sq", name: "مربع ١:١" },
      { id: "land", name: "أفقي ١٦:٩" },
      { id: "port", name: "عمودي ٩:١٦" },
      { id: "four", name: "أفقي ٤:٣" },
      { id: "three", name: "عمودي ٣:٤" },
    ],
    ideas: IDEAS,
    ideaCats: IDEA_CATS,
    quota: q,
  });
}
