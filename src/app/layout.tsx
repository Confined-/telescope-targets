import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tonight's Best Telescope Targets",
  description:
    "Optimal deep-sky and planet targets for your location, telescope and sky brightness.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <noscript>
          <div
            style={{
              background: "#78350a",
              color: "#fff",
              font: "14px system-ui",
              padding: "12px",
              textAlign: "center",
            }}
          >
            JavaScript is blocked, so search and results can&apos;t work. In
            Brave: tap ⋮ → Shields → allow scripts for this site (or set
            Shields down), then reload the page.
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
