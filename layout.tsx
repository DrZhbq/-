import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "最后一手 · 在线德州扑克",
  description: "和朋友一起玩德州扑克，最多六人同桌，也可单机练习。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
