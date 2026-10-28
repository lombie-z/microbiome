import type { Metadata } from 'next';
import { Instrument_Sans, Newsreader } from 'next/font/google';
import { SmoothScroll } from '@/components/smooth-scroll';
import { cn } from '@/lib/utils';
import './globals.css';

const instrument = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' });
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', style: ['normal', 'italic'], axes: ['opsz'] });

export const metadata: Metadata = {
  title: 'Microbiome',
  description: 'A clay micro biome modelled in Blender by Claude, and a scroll journey into it.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={cn(instrument.variable, newsreader.variable)}>
      <body>
        <SmoothScroll />
        {children}
      </body>
    </html>
  );
}
