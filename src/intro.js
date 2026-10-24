// Opening screen: drifting lights that find each other, the Kindred name, tap to enter.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['167, 123, 255', '255, 123, 197', '123, 190, 255'];

function startLights(canvas, pointer) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let dots = [];
  let frame;

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(90, Math.max(36, (w * h) / 14000)));
    dots = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 1 + Math.random() * 2.2,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
      phase: Math.random() * Math.PI * 2,
    }));
  };

  const LINK = 130;
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      if (!reduceMotion) {
        d.x += d.vx;
        d.y += d.vy;
        // Lights drift toward a finger or cursor, like they're curious.
        if (pointer.active) {
          const dx = pointer.x - d.x;
          const dy = pointer.y - d.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 220 && dist > 1) {
            d.x += (dx / dist) * 0.6;
            d.y += (dy / dist) * 0.6;
          }
        }
        if (d.x < -20) d.x = w + 20;
        if (d.x > w + 20) d.x = -20;
        if (d.y < -20) d.y = h + 20;
        if (d.y > h + 20) d.y = -20;
      }
    }
    // Lights that drift close together are linked, because kindred spirits find each other.
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i];
        const b = dots[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist < LINK) {
          ctx.strokeStyle = `rgba(${a.c}, ${(1 - dist / LINK) * 0.35})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    for (const d of dots) {
      const glow = 0.55 + 0.45 * Math.sin(t / 900 + d.phase);
      ctx.fillStyle = `rgba(${d.c}, ${glow})`;
      ctx.shadowColor = `rgba(${d.c}, 0.9)`;
      ctx.shadowBlur = 12;
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

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
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
        <div class="intro-mark" aria-hidden="true"></div>
        <h1 class="intro-title" aria-hidden="true">${[...'Kindred'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('')}</h1>
        <p class="intro-tagline">Characters that feel like yours</p>
      </div>
      <p class="intro-enter">Tap to enter</p>`;
    document.body.appendChild(el);

    const pointer = { x: 0, y: 0, active: false };
    const move = (e) => {
      const p = e.touches?.[0] ?? e;
      pointer.x = p.clientX;
      pointer.y = p.clientY;
      pointer.active = true;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', () => (pointer.active = false));
    const stopLights = startLights(el.querySelector('canvas'), pointer);
    el.focus({ preventScroll: true });

    let entered = false;
    const enter = () => {
      if (entered) return;
      entered = true;
      el.classList.add('leaving');
      const finish = () => {
        stopLights();
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
