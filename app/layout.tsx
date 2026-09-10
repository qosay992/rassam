import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "رسّام — استوديو الصور بالذكاء الاصطناعي",
  description: "استوديو عربي لتوليد الصور بالذكاء الاصطناعي: اكتب بالعربية واحصل على صور احترافية مجاناً",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#d4a437",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="bg-orn" />
        {children}
      </body>
    </html>
  );
}
