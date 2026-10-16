'use strict';
// Baut public/index.html aus src/app.html (der App, wie sie auf claude.ai läuft):
//  - vollständiges HTML-Gerüst drumherum
//  - Verbindung zum eigenen Server (claude-shim.js) statt claude.ai
//  - Schriften lokal statt von Google Fonts, damit alles offline läuft
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/app.html'), 'utf8');

const googleFonts = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/;
if (!googleFonts.test(app)) throw new Error('Google-Fonts-Einbindung in src/app.html nicht gefunden');
const body = app.replace(googleFonts, '<link rel="stylesheet" href="/fonts/fonts.css">');

// Schriften kopieren (nur die genutzten Schnitte, latin und latin-ext)
const fonts = [
  ['atkinson-hyperlegible', 'Atkinson Hyperlegible', [400, 700]],
  ['bricolage-grotesque', 'Bricolage Grotesque', [600, 800]],
];
let css = '';
for (const [pkg, family, weights] of fonts) {
  for (const w of weights) {
    for (const subset of ['latin', 'latin-ext']) {
      const file = `${pkg}-${subset}-${w}-normal.woff2`;
      fs.copyFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', file), path.join(root, 'public/fonts', file));
      const range = subset === 'latin'
        ? 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
        : 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
      css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${file}) format("woff2");unicode-range:${range};}\n`;
    }
  }
}
fs.writeFileSync(path.join(root, 'public/fonts/fonts.css'), css);

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}</style>
<script src="/claude-shim.js"></script>
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'public/index.html'), html);
console.log('public/index.html gebaut,', Math.round(html.length / 1024), 'KB');

// Landingpage: Markenbilder einsetzen, Kartenbilder als eigene Dateien ablegen
const assets = JSON.parse(fs.readFileSync(path.join(root, 'src/landing-assets.json'), 'utf8'));
fs.mkdirSync(path.join(root, 'public/cards'), { recursive: true });
for (const [value, dataUrl] of Object.entries(assets.CARDS)) {
  const m = /^data:image\/webp;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Kartenbild ' + value + ' ist kein WebP');
  fs.writeFileSync(path.join(root, 'public/cards', `card-${value}.webp`), Buffer.from(m[1], 'base64'));
}
let landing = fs.readFileSync(path.join(root, 'src/landing.html'), 'utf8');
for (const key of ['WORDMARK', 'TK', 'PIXELS']) landing = landing.split(`%%${key}%%`).join(assets[key]);
if (/%%[A-Z_]+%%/.test(landing)) throw new Error('Platzhalter in src/landing.html nicht ersetzt');
fs.writeFileSync(path.join(root, 'public/landing.html'), landing);
console.log('public/landing.html gebaut,', Math.round(landing.length / 1024), 'KB');
