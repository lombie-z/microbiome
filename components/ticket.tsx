'use client';

import { useEffect, useRef } from 'react';
import { journey, smoothstep } from '@/lib/journey';

// The way in: an admission ticket in the top right, "Scroll to enter". As you scroll through the pre-roll (the pixel
// sweep, lib/journey.ts PRE_ROLL) its stub tears off along the perforation, tumbles away and breaks up into pixels;
// the rest of the ticket goes to pixels as the sweep's wave reaches the corner. Drawn on its own small canvas so it
// can pixelate like the scene.

const W = 232; // CSS px
const H = 104;
const STUB = 64; // the stub's width, on the right
const CELL = 4; // the scene's pixel size (lib/journey.ts pixelSize)

const PLASTER = '#f5f2ed';
const INK = '#2b2622';
const MUTED = '#8a817a';

function hash(x: number, y: number) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** The ticket's two halves, drawn separately so the stub can tear away; the torn edge is jagged and shared. */
function drawTicket(ctx: CanvasRenderingContext2D, part: 'body' | 'stub', font: string, serif: string) {
  const tear = W - STUB;
  ctx.save();
  ctx.beginPath();
  // Outline with notched corners and the torn edge down the perforation.
  const notch = 7;
  const edge: [number, number][] = [];
  for (let y = 0; y <= H; y += 4) edge.push([tear + (hash(y, 1) - 0.5) * 3, y]);
  if (part === 'body') {
    ctx.moveTo(notch, 0);
    ctx.lineTo(tear, 0);
    for (const [x, y] of edge) ctx.lineTo(x, y);
    ctx.lineTo(notch, H);
    ctx.arc(0, H, notch, 0, -Math.PI / 2, true);
    ctx.lineTo(0, notch);
    ctx.arc(0, 0, notch, Math.PI / 2, 0, true);
  } else {
    ctx.moveTo(tear, 0);
    ctx.lineTo(W - notch, 0);
    ctx.arc(W, 0, notch, Math.PI, Math.PI / 2, true);
    ctx.lineTo(W, H - notch);
    ctx.arc(W, H, notch, -Math.PI / 2, Math.PI, true);
    for (const [x, y] of [...edge].reverse()) ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = PLASTER;
  ctx.shadowColor = 'rgba(40, 30, 20, 0.18)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.clip();

  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';
  if (part === 'body') {
    ctx.font = `600 9px ${font}`;
    ctx.fillStyle = MUTED;
    ctx.fillText('ADMIT ONE  ·  MICRO BIOME', 16, 24);
    ctx.font = `italic 400 26px ${serif}`;
    ctx.fillStyle = INK;
    ctx.fillText('Scroll to enter', 16, 60);
    ctx.font = `600 9px ${font}`;
    ctx.fillStyle = MUTED;
    ctx.fillText('NO. 000 001', 16, 86);
    // An arrow down.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(146, 76);
    ctx.lineTo(146, 90);
    ctx.moveTo(141, 85);
    ctx.lineTo(146, 90);
    ctx.lineTo(151, 85);
    ctx.stroke();
  } else {
    // Perforation dots, and the stub's number turned on its side.
    ctx.fillStyle = MUTED;
    for (let y = 6; y < H; y += 7) ctx.fillRect(tear + 2, y, 2, 2);
    ctx.save();
    ctx.translate(tear + STUB / 2 + 4, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `600 9px ${font}`;
    ctx.textAlign = 'center';
    ctx.fillText('ENTRY', 0, -6);
    ctx.font = `italic 400 18px ${serif}`;
    ctx.fillStyle = INK;
    ctx.fillText('001', 0, 14);
    ctx.restore();
  }
  ctx.restore();
}

/** Draws `source` into `ctx` broken up into pixel cells of `cell` px, `gone` (0 to 1) of them dropped at random. */
function pixelated(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, scale: number, cell: number, gone: number) {
  const w = Math.ceil(source.width / (cell * scale));
  const h = Math.ceil(source.height / (cell * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const s = small.getContext('2d') as CanvasRenderingContext2D;
  s.drawImage(source, 0, 0, w, h);
  if (gone > 0) {
    const img = s.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Going from the bottom-left first, as the sweep does, ragged.
        const order = 0.6 * hash(x, y) + 0.4 * (1 - (x / w + (1 - y / h)) / 2);
        if (order < gone) img.data[(y * w + x) * 4 + 3] = 0;
      }
    s.putImageData(img, 0, 0);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, source.width, source.height);
}

export function Ticket() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const scale = window.devicePixelRatio || 1;
    // Room round the ticket for the stub to tumble into.
    const PAD = 80;
    el.width = (W + PAD * 2) * scale;
    el.height = (H + PAD * 2) * scale;
    const ctx = el.getContext('2d') as CanvasRenderingContext2D;
    const style = getComputedStyle(document.body);
    const font = style.fontFamily;
    const serif = getComputedStyle(document.documentElement).getPropertyValue('--font-newsreader') || 'Georgia, serif';

    const layer = (part: 'body' | 'stub') => {
      const c = document.createElement('canvas');
      c.width = el.width;
      c.height = el.height;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.scale(scale, scale);
      g.translate(PAD, PAD);
      drawTicket(g, part, font, serif);
      return c;
    };
    let body = layer('body');
    let stub = layer('stub');
    // Redraw once the web fonts are in.
    document.fonts?.ready.then(() => {
      body = layer('body');
      stub = layer('stub');
      last = -1;
    });
    const scratch = document.createElement('canvas');
    scratch.width = el.width;
    scratch.height = el.height;
    const sc = scratch.getContext('2d') as CanvasRenderingContext2D;

    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = journey.sweep;
      if (s === last) return;
      last = s;
      ctx.clearRect(0, 0, el.width, el.height);
      // The stub: tears off, swinging down round its top corner, then drops into the oncoming wave, breaking up into
      // pixels as it goes.
      const tear = smoothstep(0.02, 0.4, s);
      const stubGone = smoothstep(0.25, 0.62, s);
      if (stubGone < 1) {
        sc.clearRect(0, 0, el.width, el.height);
        sc.save();
        const pivotX = (PAD + W) * scale;
        const pivotY = PAD * scale;
        sc.translate(pivotX - tear * 24 * scale, pivotY + tear * tear * 120 * scale);
        sc.rotate(-tear * 0.55);
        sc.translate(-pivotX, -pivotY);
        sc.drawImage(stub, 0, 0);
        sc.restore();
        if (stubGone > 0 || tear > 0.3) pixelated(ctx, scratch, scale, CELL * (1 + stubGone * 1.5), stubGone);
        else ctx.drawImage(scratch, 0, 0);
      }
      // The body: whole until the sweep's wave reaches the corner, then to pixels with it.
      const bodyGone = smoothstep(0.7, 0.95, s);
      if (bodyGone < 1) {
        if (bodyGone > 0) pixelated(ctx, body, scale, CELL, bodyGone);
        else ctx.drawImage(body, 0, 0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-label="Scroll to enter"
      role="img"
      className="pointer-events-none fixed top-0 right-0 z-10"
      style={{ width: W + 160, height: H + 160, marginTop: -60, marginRight: -60 }}
    />
  );
}
