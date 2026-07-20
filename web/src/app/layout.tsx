import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/site-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Soundcheck: voice model evaluation",
  description:
    "Reference-free evaluation for Gradium TTS: objective defect metrics, structured human review, and the gap between them.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteNav />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t">
          <div className="mx-auto max-w-7xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
            Soundcheck · reference-free TTS evaluation · objective metrics computed
            offline by the harness, human review collected here.
          </div>
        </footer>
      </body>
    </html>
  );
}
