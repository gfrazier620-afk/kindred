// The Kindred mark: two linked rings, two kindred spirits finding each other.
let count = 0;

export function logoSvg(size = 64) {
  const id = `kl${count++}`; // gradient ids must be unique per instance
  return `
    <svg class="logo" width="${size}" height="${size}" viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="${id}a" x1="8" y1="30" x2="62" y2="76" gradientUnits="userSpaceOnUse">
          <stop stop-color="#f4f4f7"/><stop offset="1" stop-color="#9a9da8"/>
        </linearGradient>
        <linearGradient id="${id}b" x1="38" y1="30" x2="92" y2="76" gradientUnits="userSpaceOnUse">
          <stop stop-color="#ffb066"/><stop offset="1" stop-color="#ff6a1a"/>
        </linearGradient>
      </defs>
      <circle cx="37" cy="50" r="24" stroke="url(#${id}a)" stroke-width="8"/>
      <circle cx="63" cy="50" r="24" stroke="url(#${id}b)" stroke-width="8" style="mix-blend-mode:screen"/>
      <circle cx="50" cy="50" r="4.5" fill="#fff"/>
    </svg>`;
}
