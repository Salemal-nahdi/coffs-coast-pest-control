import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Client Portal | Coffs Coast Pest Control",
  description:
    "Client social media content approval portal for Coffs Coast Pest Control.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-montserrat bg-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}
