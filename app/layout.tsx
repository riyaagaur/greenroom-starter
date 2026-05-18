import type { Metadata, Viewport } from "next";
const GeistSans = { variable: "--font-geist-sans" };
const GeistMono = { variable: "--font-geist-mono" };
import { Fraunces } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { CommandPaletteData } from "@/components/command-palette/command-data";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: {
    default: "Greenroom · The Crescent",
    template: "%s · Greenroom",
  },
  description:
    "Operating system for independent music venues. Bookings, settlement, advancing — in one place.",
  applicationName: "Greenroom",
  authors: [{ name: "Greenroom" }],
  keywords: [
    "music venue software",
    "independent venues",
    "settlement",
    "venue operations",
    "ticketing",
    "indie music",
  ],
  openGraph: {
    type: "website",
    title: "Greenroom",
    description:
      "Operating system for independent music venues. Bookings, settlement, advancing — in one place.",
    siteName: "Greenroom",
  },
  twitter: {
    card: "summary_large_image",
    title: "Greenroom",
    description:
      "Operating system for independent music venues.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1814" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex font-sans">
        <Sidebar />
        <main className="flex-1 overflow-auto relative">{children}</main>
        <CommandPaletteData />
      </body>
    </html>
  );
}
