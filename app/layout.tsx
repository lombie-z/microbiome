import type { Metadata } from 'next';
import { Instrument_Sans, Newsreader, Oswald, Permanent_Marker, Share_Tech_Mono } from 'next/font/google';
import { cn } from '@/lib/utils';
import './globals.css';

const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' });
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', style: ['normal', 'italic'], axes: ['opsz'] });
// For the ticket (components/ticket.tsx): its thermal print, the marker scrawled over it, and the band along its foot.
const print = Share_Tech_Mono({ subsets: ['latin'], weight: '400', variable: '--font-print' });
const marker = Permanent_Marker({ subsets: ['latin'], weight: '400', variable: '--font-marker' });
const band = Oswald({ subsets: ['latin'], weight: '700', variable: '--font-band' });

export const metadata: Metadata = {
  title: 'Microbiome',
  description: 'A clay micro biome modelled in Blender by Claude, and a scroll journey into it.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={cn(instrument.variable, newsreader.variable, print.variable, marker.variable, band.variable)}>
      <body>{children}</body>
    </html>
  );
}
