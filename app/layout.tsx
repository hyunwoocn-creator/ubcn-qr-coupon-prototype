import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "쿠폰 발급 신청",
  description: "QR 기반 모바일 쿠폰 발급 프로토타입",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
