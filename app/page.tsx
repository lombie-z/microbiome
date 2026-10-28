import { Journey } from '@/components/journey';

export default function Home() {
  return (
    <main>
      <h1 className="sr-only">Microbiome</h1>
      <Journey />
      {/* The scroll track the camera journey runs along. */}
      <div className="relative z-10 h-[1820svh]">
        <section className="pointer-events-none flex h-svh flex-col items-center justify-end pb-8 text-center" aria-label="Intro">
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Claude-powered Modelling for Interactive Web Experiences</p>
          <p className="mt-2 text-xs">Scroll to go in</p>
        </section>
      </div>
    </main>
  );
}
