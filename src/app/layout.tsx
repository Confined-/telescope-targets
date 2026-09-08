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
      <body className="min-h-screen flex flex-col">
        {/* Red-matrix filter for night-vision mode (see .night-mode). */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <filter id="night-red" colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values="0.1807 0.6079 0.0614 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              />
            </filter>
          </defs>
        </svg>
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
