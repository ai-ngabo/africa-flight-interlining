import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AfriRoute',
  description: 'Fair, multi-carrier and multi-modal trips across Africa with self-transfer protection.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f766e' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1210' },
  ],
};

// Applies the saved theme before first paint so there is no light/dark flash.
const themeBootstrap = `(function(){try{var t=localStorage.getItem('afriroute:theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
