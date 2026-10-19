import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DayStash — Offline-First Multi-Device Reminders',
  description: 'Synchronized, recurrence-aware reminder engine across mobile, web, and cloud workers.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="theme-color" content="#090d16" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-background text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
