// Opening screen: a near-black sky with grey stars and orange embers drifting past,
// the glowing Kindred name, tap to enter.
import { logoSvg } from './logo.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GREYS = ['205, 207, 216', '150, 153, 164', '112, 115, 126'];
const ORANGES = ['255, 140, 50', '255, 106, 26', '255, 176, 102'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (min, max) => min + Math.random() * (max - min);

function startParticles(canvas, pointer) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dots = [];
  let frame;
  let bursting = false;

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const area = w * h;
    const stars = Math.round(Math.min(170, Math.max(60, area / 6500)));
    const embers = Math.round(Math.min(46, Math.max(16, area / 20000)));
    dots = [
      // Stars: tiny, grey, twinkling, barely moving.
      ...Array.from({ length: stars }, () => ({
        kind: 'star', x: rand(0, w), y: rand(0, h), r: rand(0.4, 1.3), c: pick(GREYS),
        vx: rand(-0.04, 0.04), vy: rand(-0.04, 0.02), phase: rand(0, 6.28), speed: rand(700, 1800),
      })),
      // Embers: larger, orange, glowing, rising slowly and swaying.
      ...Array.from({ length: embers }, () => ({
        kind: 'ember', x: rand(0, w), y: rand(0, h), r: rand(1.2, 3.4), c: pick(ORANGES),
        vx: 0, vy: -rand(0.12, 0.5), phase: rand(0, 6.28), speed: rand(1200, 2600), sway: rand(0.15, 0.5),
      })),
    ];
  };

  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h * 0.42;

    for (const d of dots) {
      const wave = Math.sin(t / d.speed + d.phase);
      if (!reduceMotion) {
        d.x += d.vx + (d.kind === 'ember' ? wave * d.sway : 0);
        d.y += d.vy;

        // Embers scatter softly away from a finger or cursor.
        if (pointer.active && d.kind === 'ember') {
          const dx = d.x - pointer.x;
          const dy = d.y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 150 && dist > 1) {
            d.x += (dx / dist) * (1 - dist / 150) * 3;
            d.y += (dy / dist) * (1 - dist / 150) * 3;
          }
        }
        // On entering, everything bursts outward from the logo.
        if (bursting) {
          d.x += (d.x - cx) * 0.045;
          d.y += (d.y - cy) * 0.045;
        }

        if (d.y < -12) { d.y = h + 12; d.x = rand(0, w); }
        if (d.y > h + 12) d.y = -12;
        if (d.x < -12) d.x = w + 12;
        if (d.x > w + 12) d.x = -12;
      }

      if (d.kind === 'star') {
        ctx.fillStyle = `rgba(${d.c}, ${0.35 + 0.5 * (0.5 + 0.5 * wave)})`;
        ctx.shadowBlur = 0;
      } else {
        const flicker = 0.6 + 0.4 * (0.5 + 0.5 * wave);
        ctx.fillStyle = `rgba(${d.c}, ${flicker})`;
        ctx.shadowColor = `rgba(${d.c}, 0.95)`;
        ctx.shadowBlur = 16;
      }
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (!reduceMotion) frame = requestAnimationFrame(draw);
  };

  resize();
  addEventListener('resize', resize);
  frame = requestAnimationFrame(draw);

  return {
    burst: () => (bursting = true),
    stop: () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
    },
  };
}

/** Shows the intro and resolves once the person taps, clicks or presses Enter. */
export function showIntro() {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'intro';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Kindred. Tap to enter.');
    el.innerHTML = `
      <canvas class="intro-lights" aria-hidden="true"></canvas>
      <div class="intro-glow" aria-hidden="true"></div>
      <div class="intro-center">
        <div class="intro-mark" aria-hidden="true">${logoSvg(96)}</div>
        <h1 class="intro-title" aria-hidden="true">${[...'Kindred'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</h1>
        <p class="intro-tagline">Every story starts with someone.</p>
      </div>
      <p class="intro-enter">Tap to enter</p>`;
    document.body.appendChild(el);

    const pointer = { x: 0, y: 0, active: false };
    el.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    });
    el.addEventListener('pointerleave', () => (pointer.active = false));
    const particles = startParticles(el.querySelector('canvas'), pointer);
    el.focus({ preventScroll: true });

    let entered = false;
    const enter = () => {
      if (entered) return;
      entered = true;
      particles.burst();
      el.classList.add('leaving');
      const finish = () => {
        particles.stop();
        el.remove();
        resolve();
      };
      // Fall back to a timer in case the transition never fires (reduced motion, hidden tab).
      el.addEventListener('transitionend', (e) => e.target === el && finish(), { once: true });
      setTimeout(finish, 900);
    };

    el.addEventListener('click', enter);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    });
  });
}
