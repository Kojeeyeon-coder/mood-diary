import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "마음의 보석함",
  description: "하루의 감정을 빛나는 보석으로 간직하고 돌아보는 로컬 감정 일기",
  icons: {
    icon: "/gem-app-icon.svg",
    shortcut: "/gem-app-icon.svg",
    apple: "/gem-app-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
