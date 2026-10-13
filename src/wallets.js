/**
 * Wallet designs. Every design is an inline SVG (viewBox 64×64) built from gradients only,
 * so it stays crisp at any size and needs no image files.
 *
 * Classes used by the animations in style.css:
 *  - .tw-peek   — what peeks out of the wallet (card, coin); jumps up when a coin flies out
 *  - .tw-lid-l / .tw-lid-r — kiss-lock knobs that open
 *  - .tw-glint  — light sweep across the wallet
 *  - .tw-twinkle — small sparkles on gold designs
 */

/* ----------------------------------------------------------- shared defs */

const goldStops = `
    <stop offset="0" stop-color="#7a4f0e"/>
    <stop offset="0.22" stop-color="#f6d985"/>
    <stop offset="0.42" stop-color="#b9861f"/>
    <stop offset="0.6" stop-color="#fff2bf"/>
    <stop offset="0.8" stop-color="#ad7716"/>
    <stop offset="1" stop-color="#e8bf57"/>`;

const sharedDefs = (id) => `
    <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1">${goldStops}</linearGradient>
    <linearGradient id="${id}-goldh" x1="0" y1="0" x2="1" y2="0">${goldStops}</linearGradient>
    <radialGradient id="${id}-ball" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stop-color="#fffbe8"/>
        <stop offset="0.3" stop-color="#f7d468"/>
        <stop offset="0.72" stop-color="#a86f0e"/>
        <stop offset="1" stop-color="#5e3c06"/>
    </radialGradient>
    <linearGradient id="${id}-sheen" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="0.28"/>
        <stop offset="0.3" stop-color="#fff" stop-opacity="0.06"/>
        <stop offset="0.55" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-glint" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.6"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>`;

/** Light sweep, clipped to the wallet body */
const glint = (id) => `
    <g clip-path="url(#${id}-clip)" class="tw-glint-wrap">
        <g class="tw-glint"><rect x="-16" y="0" width="9" height="70" fill="url(#${id}-glint)" transform="skewX(-24)"/></g>
    </g>`;

/** A gold coin with a rim */
const coin = (id, cx, cy, r = 6) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-ball)" stroke="#6e4808" stroke-width="0.8"/>
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.68).toFixed(2)}" fill="none" stroke="#fff3c4" stroke-opacity="0.65" stroke-width="0.6"/>`;

/** Four-point sparkle */
const sparkle = (x, y, s, delay = 0) => `
    <path class="tw-twinkle" style="animation-delay:${delay}s" transform="translate(${x} ${y}) scale(${s})"
        d="M0 -4 C0.5 -0.6 0.6 -0.5 4 0 C0.6 0.5 0.5 0.6 0 4 C-0.5 0.6 -0.6 0.5 -4 0 C-0.6 -0.5 -0.5 -0.6 0 -4 Z" fill="#fffbe6"/>`;

const svg = (body) => `<svg class="tw-wallet-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;

/* ------------------------------------------------------- bifold wallets */

/**
 * Bifold wallet with a strap flap: used by Noir, Royal and the croc leathers.
 * @param {string} id
 * @param {object} o
 */
function bifold(id, o) {
    const texture = o.texture ? `<rect x="6" y="19" width="52" height="36" rx="7" fill="url(#${id}-tex)"/>` : '';
    const textureFlap = o.texture ? `<path d="M58 28 H41.5 a8.5 8.5 0 0 0 0 17 H58 Z" fill="url(#${id}-tex)"/>` : '';
    return svg(`
    <defs>
        ${sharedDefs(id)}
        <linearGradient id="${id}-body" x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0" stop-color="${o.body[0]}"/>
            <stop offset="0.5" stop-color="${o.body[1]}"/>
            <stop offset="1" stop-color="${o.body[2]}"/>
        </linearGradient>
        <linearGradient id="${id}-flap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${o.flap[0]}"/>
            <stop offset="1" stop-color="${o.flap[1]}"/>
        </linearGradient>
        ${o.textureDefs ? o.textureDefs(id) : ''}
        <clipPath id="${id}-clip"><rect x="6" y="19" width="52" height="36" rx="7"/></clipPath>
    </defs>
    <g class="tw-peek">
        <g transform="rotate(-8 27 17)">
            <rect x="12" y="8.5" width="30" height="18.5" rx="2.6" fill="url(#${id}-gold)"/>
            <rect x="15.5" y="12.6" width="6.2" height="4.6" rx="1.1" fill="#5c3d0b" opacity="0.5"/>
            <path d="M15.5 21.5 H37 M15.5 23.6 H28" stroke="#6b4a10" stroke-opacity="0.45" stroke-width="0.9"/>
        </g>
        ${coin(id, 46.5, 15.5, 6.2)}
    </g>
    <rect x="6" y="19" width="52" height="36" rx="7" fill="url(#${id}-body)"/>
    ${texture}
    <rect x="6" y="19" width="52" height="36" rx="7" fill="url(#${id}-sheen)"/>
    <rect x="6.65" y="19.65" width="50.7" height="34.7" rx="6.35" fill="none" stroke="url(#${id}-gold)" stroke-width="1.3"/>
    <rect x="9.5" y="22.5" width="45" height="29" rx="4.4" fill="none" stroke="${o.stitch}" stroke-width="0.7" stroke-dasharray="1.8 1.4"/>
    <path d="M6.65 31 V26 a6.35 6.35 0 0 1 6.35 -6.35 H18" fill="none" stroke="url(#${id}-gold)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M6.65 43 V48 a6.35 6.35 0 0 0 6.35 6.35 H18" fill="none" stroke="url(#${id}-gold)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M58 28 H41.5 a8.5 8.5 0 0 0 0 17 H58 Z" fill="url(#${id}-flap)"/>
    ${textureFlap}
    <path d="M58 28 H41.5 a8.5 8.5 0 0 0 0 17 H58" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="1.6"/>
    <path d="M57.4 28.7 H41.5 a7.8 7.8 0 0 0 0 15.6 H57.4" fill="none" stroke="url(#${id}-gold)" stroke-width="1.1"/>
    ${o.emblem(id)}
    ${glint(id)}`);
}

const roundClasp = (id) => `
    <circle cx="43.2" cy="36.5" r="4.4" fill="url(#${id}-ball)" stroke="#5e3c06" stroke-width="0.5"/>
    <circle cx="43.2" cy="36.5" r="2.6" fill="none" stroke="#fff6cf" stroke-opacity="0.75" stroke-width="0.55"/>
    <circle cx="42" cy="35.2" r="0.9" fill="#fff" opacity="0.8"/>`;

const crownClasp = (id) => `
    <path d="M38.6 40.2 L37.4 32.6 L41 35.6 L43.6 30.6 L46.2 35.6 L49.8 32.6 L48.6 40.2 Z"
        fill="url(#${id}-gold)" stroke="#5e3c06" stroke-width="0.5" stroke-linejoin="round"/>
    <rect x="38.4" y="40.2" width="10.4" height="2" rx="0.6" fill="url(#${id}-goldh)" stroke="#5e3c06" stroke-width="0.4"/>
    <circle cx="37.4" cy="32.4" r="0.95" fill="url(#${id}-ball)"/>
    <circle cx="43.6" cy="30.3" r="1.05" fill="url(#${id}-ball)"/>
    <circle cx="49.8" cy="32.4" r="0.95" fill="url(#${id}-ball)"/>
    <circle cx="43.6" cy="37.3" r="1.15" fill="#d81b4a" stroke="#fff" stroke-opacity="0.5" stroke-width="0.3"/>`;

const barClasp = (id) => `
    <rect x="38.6" y="33.4" width="9.6" height="6.2" rx="1.6" fill="url(#${id}-goldh)" stroke="#5e3c06" stroke-width="0.5"/>
    <rect x="40.2" y="35" width="6.4" height="3" rx="1" fill="none" stroke="#fff3c4" stroke-opacity="0.7" stroke-width="0.5"/>`;

/** Croc scales: staggered rows of small rounded tiles of slightly different sizes */
const crocTexture = (dark, light) => (id) => {
    const tile = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${light}" fill-opacity="0.1" stroke="${dark}" stroke-opacity="0.42" stroke-width="0.55"/>`;
    return `
    <pattern id="${id}-tex" width="12" height="9" patternUnits="userSpaceOnUse" patternTransform="translate(6 19)">
        ${tile(0.4, 0.4, 5.4, 3.7)}${tile(6.4, 0.4, 5.2, 3.7)}
        ${tile(-2.6, 4.9, 5.6, 3.7)}${tile(3.4, 4.9, 5.2, 3.7)}${tile(9.4, 4.9, 5.6, 3.7)}
    </pattern>`;
};

/* -------------------------------------------------------- quilted clutch */

function quilted(id, o) {
    return svg(`
    <defs>
        ${sharedDefs(id)}
        <linearGradient id="${id}-body" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0" stop-color="${o.body[0]}"/>
            <stop offset="1" stop-color="${o.body[1]}"/>
        </linearGradient>
        <pattern id="${id}-quilt" width="7.5" height="7.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45 32 38)">
            <path d="M0 0 H7.5 M0 0 V7.5" stroke="${o.seam}" stroke-width="1"/>
            <path d="M0 0.9 H7.5 M0.9 0 V7.5" stroke="#fff" stroke-opacity="${o.seamLight}" stroke-width="0.6"/>
        </pattern>
        <radialGradient id="${id}-puff" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stop-color="#fff" stop-opacity="0.1"/>
            <stop offset="1" stop-color="#000" stop-opacity="0.12"/>
        </radialGradient>
        <pattern id="${id}-puffs" width="7.5" height="7.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45 32 38)">
            <rect width="7.5" height="7.5" fill="url(#${id}-puff)"/>
        </pattern>
        <clipPath id="${id}-clip"><rect x="7" y="22" width="50" height="33" rx="6"/></clipPath>
    </defs>
    <path d="M12.5 23.5 C 14 4, 50 4, 51.5 23.5" fill="none" stroke="#4a3006" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="2.4 1.7"/>
    <path d="M12.5 23.5 C 14 4, 50 4, 51.5 23.5" fill="none" stroke="url(#${id}-gold)" stroke-width="2" stroke-linecap="round" stroke-dasharray="2.4 1.7"/>
    <path d="M12.5 23.5 C 14 4, 50 4, 51.5 23.5" fill="none" stroke="#fff4c8" stroke-opacity="0.6" stroke-width="0.6" stroke-dasharray="1 3.1" stroke-dashoffset="-0.6"/>
    <g class="tw-peek">${coin(id, 38, 21.5, 5.6)}</g>
    <rect x="7" y="22" width="50" height="33" rx="6" fill="url(#${id}-body)"/>
    <rect x="7" y="22" width="50" height="33" rx="6" fill="url(#${id}-puffs)"/>
    <rect x="7" y="22" width="50" height="33" rx="6" fill="url(#${id}-quilt)"/>
    <rect x="7" y="22" width="50" height="33" rx="6" fill="url(#${id}-sheen)"/>
    <path d="M7.6 41.5 C 20 44.5, 44 44.5, 56.4 41.5" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="1.6"/>
    <path d="M7.6 40.6 C 20 43.6, 44 43.6, 56.4 40.6" fill="none" stroke="url(#${id}-goldh)" stroke-width="0.8"/>
    <rect x="7.6" y="22.6" width="48.8" height="31.8" rx="5.4" fill="none" stroke="url(#${id}-gold)" stroke-width="1.1"/>
    <circle cx="12.5" cy="24.2" r="1.9" fill="none" stroke="url(#${id}-gold)" stroke-width="1.3"/>
    <circle cx="51.5" cy="24.2" r="1.9" fill="none" stroke="url(#${id}-gold)" stroke-width="1.3"/>
    <rect x="26.6" y="38.4" width="10.8" height="7.6" rx="2" fill="url(#${id}-goldh)" stroke="#5e3c06" stroke-width="0.5"/>
    <ellipse cx="32" cy="42.2" rx="3.6" ry="1.9" fill="url(#${id}-ball)" stroke="#5e3c06" stroke-width="0.4"/>
    <rect x="27.6" y="39.3" width="8.8" height="5.8" rx="1.5" fill="none" stroke="#fff3c4" stroke-opacity="0.6" stroke-width="0.45"/>
    ${glint(id)}`);
}

/* ------------------------------------------------------ kiss-lock purse */

function kisslock(id, o) {
    const bodyPath = 'M10.5 27 C 5.5 36.5, 7 49.5, 15.5 54.2 Q 32 59 48.5 54.2 C 57 49.5, 58.5 36.5, 53.5 27 Z';
    return svg(`
    <defs>
        ${sharedDefs(id)}
        <radialGradient id="${id}-velvet" cx="0.38" cy="0.32" r="0.85">
            <stop offset="0" stop-color="${o.velvet[0]}"/>
            <stop offset="0.5" stop-color="${o.velvet[1]}"/>
            <stop offset="1" stop-color="${o.velvet[2]}"/>
        </radialGradient>
        <clipPath id="${id}-clip"><path d="${bodyPath}"/></clipPath>
    </defs>
    <g class="tw-peek">${coin(id, 37.5, 27, 5.6)}</g>
    <path d="${bodyPath}" fill="url(#${id}-velvet)"/>
    <g clip-path="url(#${id}-clip)" fill="none" stroke-linecap="round">
        <path d="M17 28 Q 13.5 41 18 56" stroke="#000" stroke-opacity="0.22" stroke-width="1.6"/>
        <path d="M24 27 Q 22.5 42 25 58" stroke="#000" stroke-opacity="0.16" stroke-width="1.4"/>
        <path d="M40 27 Q 41.5 42 39 58" stroke="#000" stroke-opacity="0.16" stroke-width="1.4"/>
        <path d="M47 28 Q 50.5 41 46 56" stroke="#000" stroke-opacity="0.22" stroke-width="1.6"/>
        <path d="M18.4 28.5 Q 15.2 41 19.4 55" stroke="#fff" stroke-opacity="0.12" stroke-width="0.8"/>
        <path d="M41.4 28 Q 43 42 40.4 57" stroke="#fff" stroke-opacity="0.1" stroke-width="0.8"/>
    </g>
    <path d="${bodyPath}" fill="url(#${id}-sheen)"/>
    <path d="M31.2 49.5 l0.8 -2.4 l0.8 2.4 l2.4 0.8 l-2.4 0.8 l-0.8 2.4 l-0.8 -2.4 l-2.4 -0.8 Z" fill="url(#${id}-gold)" opacity="0.9"/>
    <circle cx="32" cy="50.3" r="1" fill="${o.gem}" stroke="#fff" stroke-opacity="0.5" stroke-width="0.25"/>
    <path d="M9.6 28.4 Q 32 21.2 54.4 28.4" fill="none" stroke="#4a3006" stroke-width="4" stroke-linecap="round"/>
    <path d="M9.6 27.9 Q 32 20.7 54.4 27.9" fill="none" stroke="url(#${id}-goldh)" stroke-width="3" stroke-linecap="round"/>
    <path d="M10.5 27 Q 32 19.9 53.5 27" fill="none" stroke="#fff6d2" stroke-opacity="0.7" stroke-width="0.6" stroke-linecap="round"/>
    <circle cx="9.8" cy="28.3" r="2" fill="url(#${id}-ball)"/>
    <circle cx="54.2" cy="28.3" r="2" fill="url(#${id}-ball)"/>
    <g class="tw-lid-l">
        <path d="M30.6 24.6 V21.8" stroke="url(#${id}-goldh)" stroke-width="1.6"/>
        <circle cx="30" cy="19.2" r="3.1" fill="url(#${id}-ball)" stroke="#5e3c06" stroke-width="0.4"/>
    </g>
    <g class="tw-lid-r">
        <path d="M33.4 24.6 V21.8" stroke="url(#${id}-goldh)" stroke-width="1.6"/>
        <circle cx="34" cy="19.2" r="3.1" fill="url(#${id}-ball)" stroke="#5e3c06" stroke-width="0.4"/>
    </g>
    ${glint(id)}`);
}

/* ------------------------------------------------ gold minaudière clutch */

function minaudiere(id, o) {
    const rays = [];
    for (let angle = -75; angle <= 75; angle += 9) {
        const rad = (angle * Math.PI) / 180;
        const x = 32 + Math.sin(rad) * 48;
        const y = 58 - Math.cos(rad) * 48;
        rays.push(`M32 58 L${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    return svg(`
    <defs>
        ${sharedDefs(id)}
        <linearGradient id="${id}-plate" x1="0" y1="0" x2="0.9" y2="1">
            <stop offset="0" stop-color="#fff0b5"/>
            <stop offset="0.25" stop-color="#e2b546"/>
            <stop offset="0.5" stop-color="#a87313"/>
            <stop offset="0.72" stop-color="#f3d27a"/>
            <stop offset="1" stop-color="#8c5c0e"/>
        </linearGradient>
        <linearGradient id="${id}-gem" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stop-color="${o.gem[0]}"/>
            <stop offset="0.5" stop-color="${o.gem[1]}"/>
            <stop offset="1" stop-color="${o.gem[2]}"/>
        </linearGradient>
        <clipPath id="${id}-clip"><rect x="7" y="21" width="50" height="33" rx="8"/></clipPath>
    </defs>
    <g class="tw-peek">${coin(id, 45, 18.5, 5.8)}</g>
    <rect x="7" y="21" width="50" height="33" rx="8" fill="url(#${id}-plate)"/>
    <g clip-path="url(#${id}-clip)">
        <path d="${rays.join(' ')}" stroke="#5e3c06" stroke-opacity="0.38" stroke-width="0.7"/>
        <path d="${rays.join(' ')}" stroke="#fff6d2" stroke-opacity="0.35" stroke-width="0.4" transform="translate(0.5 0)"/>
        <path d="M7 29 H57" stroke="#5e3c06" stroke-opacity="0.45" stroke-width="0.8"/>
        <path d="M7 29.8 H57" stroke="#fff6d2" stroke-opacity="0.55" stroke-width="0.5"/>
        <rect x="7" y="21" width="50" height="8" fill="#fff" opacity="0.12"/>
    </g>
    <rect x="7" y="21" width="50" height="33" rx="8" fill="url(#${id}-sheen)"/>
    <rect x="7.6" y="21.6" width="48.8" height="31.8" rx="7.4" fill="none" stroke="#fff6d2" stroke-opacity="0.65" stroke-width="0.8"/>
    <rect x="7" y="21" width="50" height="33" rx="8" fill="none" stroke="#6b4508" stroke-opacity="0.8" stroke-width="0.7"/>
    <circle cx="32" cy="25.4" r="5.4" fill="url(#${id}-ball)" stroke="#5e3c06" stroke-width="0.5"/>
    <path d="M32 21.2 L35.6 23.3 L35.6 27.5 L32 29.6 L28.4 27.5 L28.4 23.3 Z" fill="url(#${id}-gem)" stroke="#fff" stroke-opacity="0.35" stroke-width="0.35"/>
    <path d="M32 21.2 L32 29.6 M28.4 23.3 L35.6 27.5 M35.6 23.3 L28.4 27.5" stroke="#fff" stroke-opacity="0.22" stroke-width="0.3"/>
    <path d="M30 23 L31.6 22.2 L31.6 24.4 Z" fill="#fff" opacity="0.75"/>
    ${sparkle(14, 26, 0.55, 0)}
    ${sparkle(51, 47, 0.45, 1.3)}
    ${glint(id)}`);
}

/* ----------------------------------------------------- classic (simple) */

function classic(id) {
    return svg(`
    <defs>
        ${sharedDefs(id)}
        <linearGradient id="${id}-body" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0" stop-color="#34b386"/>
            <stop offset="1" stop-color="#0d523d"/>
        </linearGradient>
        <linearGradient id="${id}-flap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#23946b"/>
            <stop offset="1" stop-color="#0a4434"/>
        </linearGradient>
        <linearGradient id="${id}-note" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#c9f5d3"/>
            <stop offset="1" stop-color="#5fb37a"/>
        </linearGradient>
        <clipPath id="${id}-clip"><rect x="5" y="18" width="54" height="38" rx="9"/></clipPath>
    </defs>
    <g class="tw-peek">
        <g transform="rotate(-9 30 17)">
            <rect x="13" y="7" width="34" height="20" rx="2.5" fill="url(#${id}-note)"/>
            <rect x="15.5" y="9.5" width="29" height="15" rx="1.5" fill="none" stroke="rgba(25,90,45,.35)" stroke-width=".8"/>
            <circle cx="30" cy="17" r="3.6" fill="none" stroke="rgba(25,90,45,.45)" stroke-width="1.1"/>
        </g>
        <circle cx="46" cy="16" r="6.2" fill="url(#${id}-ball)" stroke="#94640d" stroke-width=".9"/>
    </g>
    <rect x="5" y="18" width="54" height="38" rx="9" fill="url(#${id}-body)"/>
    <path d="M11 20.6 H53" stroke="rgba(255,255,255,.30)" stroke-width="1.3" stroke-linecap="round"/>
    <rect x="8.6" y="21.6" width="46.8" height="30.8" rx="6.4" fill="none" stroke="rgba(255,255,255,.30)" stroke-width=".9" stroke-dasharray="2.2 2"/>
    <path d="M59 28.5 H40.5 a8.5 8.5 0 0 0 0 17 H59 Z" fill="url(#${id}-flap)"/>
    <path d="M59 28.5 H40.5 a8.5 8.5 0 0 0 0 17 H59" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>
    <circle cx="42" cy="37" r="3.7" fill="url(#${id}-ball)" stroke="rgba(0,0,0,.28)" stroke-width=".6"/>
    <path d="M9.5 28 q0 -5.6 6.2 -5.6 h17" stroke="rgba(255,255,255,.38)" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    ${glint(id)}`);
}

/* --------------------------------------------------------------- catalog */

/**
 * Wallet designs, in the order shown in the settings.
 * `glow` is the colour of the soft light around the wallet while a request is running.
 */
export const WALLETS = [
    {
        id: 'noir',
        name: { ru: 'Нуар', en: 'Noir' },
        hint: { ru: 'чёрная лаковая кожа, золото', en: 'black patent leather, gold' },
        glow: 'rgba(255, 205, 100, 0.55)',
        render: id => bifold(id, {
            body: ['#45454f', '#17171b', '#060607'],
            flap: ['#32323a', '#0b0b0d'],
            stitch: 'rgba(222, 184, 80, 0.6)',
            emblem: roundClasp,
        }),
    },
    {
        id: 'royal',
        name: { ru: 'Королевский', en: 'Royal' },
        hint: { ru: 'сапфировая кожа, золотая корона', en: 'sapphire leather, gold crown' },
        glow: 'rgba(120, 165, 255, 0.6)',
        render: id => bifold(id, {
            body: ['#3d5fd0', '#16297a', '#070f36'],
            flap: ['#2a46ad', '#0a1650'],
            stitch: 'rgba(230, 195, 95, 0.6)',
            emblem: crownClasp,
        }),
    },
    {
        id: 'croc-emerald',
        name: { ru: 'Изумрудный крокодил', en: 'Emerald croc' },
        hint: { ru: 'кожа крокодила, золото', en: 'croc leather, gold' },
        glow: 'rgba(80, 225, 165, 0.55)',
        render: id => bifold(id, {
            body: ['#2a9a73', '#0d5a43', '#03261b'],
            flap: ['#1c7d5d', '#053a2a'],
            stitch: 'rgba(230, 195, 95, 0.55)',
            texture: true,
            textureDefs: crocTexture('#01170f', '#bfffe6'),
            emblem: barClasp,
        }),
    },
    {
        id: 'croc-cognac',
        name: { ru: 'Коньячный крокодил', en: 'Cognac croc' },
        hint: { ru: 'кожа крокодила, золото', en: 'croc leather, gold' },
        glow: 'rgba(255, 170, 90, 0.55)',
        render: id => bifold(id, {
            body: ['#c47a38', '#7a3c12', '#341405'],
            flap: ['#a65f26', '#4b1f07'],
            stitch: 'rgba(250, 215, 130, 0.55)',
            texture: true,
            textureDefs: crocTexture('#1e0a02', '#ffe1bf'),
            emblem: barClasp,
        }),
    },
    {
        id: 'quilted-noir',
        name: { ru: 'Стёганый клатч', en: 'Quilted clutch' },
        hint: { ru: 'чёрная стёжка, золотая цепочка', en: 'black quilting, gold chain' },
        glow: 'rgba(255, 205, 100, 0.55)',
        render: id => quilted(id, { body: ['#34343a', '#08080a'], seam: '#000', seamLight: 0.16 }),
    },
    {
        id: 'quilted-rose',
        name: { ru: 'Пудровый клатч', en: 'Blush clutch' },
        hint: { ru: 'пудровая стёжка, золотая цепочка', en: 'blush quilting, gold chain' },
        glow: 'rgba(255, 170, 190, 0.6)',
        render: id => quilted(id, { body: ['#f6d3d6', '#c88b95'], seam: '#9b5764', seamLight: 0.45 }),
    },
    {
        id: 'velvet-bordeaux',
        name: { ru: 'Бархатный фермуар', en: 'Velvet kiss-lock' },
        hint: { ru: 'бордовый бархат, замок-поцелуй', en: 'bordeaux velvet, kiss-lock' },
        glow: 'rgba(255, 110, 150, 0.55)',
        render: id => kisslock(id, { velvet: ['#d0486e', '#7a1230', '#2c0410'], gem: '#e0115f' }),
    },
    {
        id: 'velvet-midnight',
        name: { ru: 'Полночный бархат', en: 'Midnight velvet' },
        hint: { ru: 'тёмно-синий бархат, сапфир', en: 'navy velvet, sapphire' },
        glow: 'rgba(130, 160, 255, 0.55)',
        render: id => kisslock(id, { velvet: ['#4c5fc0', '#1a2370', '#070a2a'], gem: '#2f6bff' }),
    },
    {
        id: 'gold-emerald',
        name: { ru: 'Золотой клатч', en: 'Gold minaudière' },
        hint: { ru: 'золото, изумруд', en: 'gold, emerald' },
        glow: 'rgba(255, 215, 110, 0.65)',
        render: id => minaudiere(id, { gem: ['#b8ffe4', '#13a36d', '#04402a'] }),
    },
    {
        id: 'gold-ruby',
        name: { ru: 'Золото и рубин', en: 'Gold & ruby' },
        hint: { ru: 'золото, рубин', en: 'gold, ruby' },
        glow: 'rgba(255, 190, 110, 0.65)',
        render: id => minaudiere(id, { gem: ['#ffc2d0', '#d0103f', '#52031a'] }),
    },
    {
        id: 'classic',
        name: { ru: 'Классический', en: 'Classic' },
        hint: { ru: 'простой зелёный', en: 'simple green' },
        glow: 'rgba(70, 220, 165, 0.55)',
        render: id => classic(id),
    },
];

export const DEFAULT_WALLET = 'noir';

/** @param {string} style */
export function getWallet(style) {
    return WALLETS.find(w => w.id === style) || WALLETS.find(w => w.id === DEFAULT_WALLET);
}

/**
 * @param {string} style Wallet design id
 * @param {string} id Unique prefix for gradient ids (several icons can be on one page)
 */
export function renderWallet(style, id) {
    return getWallet(style).render(id);
}
