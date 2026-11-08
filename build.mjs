/**
 * Build the Client bundle: embed the startup film, the traced line-art paths and
 * the Black Shores crest pieces so the browser bundle needs no Host route,
 * authentication, or separate asset request.
 *
 *   node build.mjs
 *
 * Reads client.template.js, assets/startup.mp4, assets/sketch_paths.json and
 * assets/logo_parts.json, then writes client.js.
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const read = (name) => readFile(join(here, 'assets', name));
const template = await readFile(join(here, 'client.template.js'), 'utf8');
const film = await read('startup.mp4');
const loop = await read('loop.mp4');
const sketch = JSON.parse((await read('sketch_paths.json')).toString('utf8'));
const logoParts = JSON.parse((await read('logo_parts.json')).toString('utf8'));

if (!Array.isArray(sketch.paths) || sketch.paths.length === 0) throw new Error('assets/sketch_paths.json has no paths');
if (!Array.isArray(logoParts) || logoParts.length === 0) throw new Error('assets/logo_parts.json has no parts');

const replacements = [
  ["'__DSHSK_VIDEO__'", JSON.stringify('data:video/mp4;base64,' + film.toString('base64'))],
  ["'__DSHSK_LOOP__'", JSON.stringify('data:video/mp4;base64,' + loop.toString('base64'))],
  ['__DSHSK_PATHS__', JSON.stringify(sketch)],
  ['__DSHSK_LOGO_PARTS__', JSON.stringify(logoParts)],
];

let output = template;
for (const [placeholder, value] of replacements) {
  if (!output.includes(placeholder)) throw new Error(`client.template.js lost the ${placeholder} placeholder`);
  output = output.replace(placeholder, value);
}
await writeFile(join(here, 'client.js'), output);

const filmStat = await stat(join(here, 'assets', 'startup.mp4'));
console.log(`client.js: ${(output.length / 1024 / 1024).toFixed(2)} MB (film ${(filmStat.size / 1024 / 1024).toFixed(2)} MB, ${sketch.paths.length} strokes)`);
