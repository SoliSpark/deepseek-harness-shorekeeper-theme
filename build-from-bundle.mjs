/**
 * Rebuild client.js from client.template.js using the assets already embedded in
 * an existing client.js (the upstream repository does not ship assets/, so a
 * plain `node build.mjs` cannot run). The four embedded literals are lifted out
 * of the existing bundle and substituted into the template, exactly like
 * build.mjs does with the binary assets.
 *
 *   node build-from-bundle.mjs [existing-client.js] [out-file]
 *
 * Defaults: ./client.js  ->  ./client.next.js
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = process.argv[2] || join(here, 'client.js');
const target = process.argv[3] || join(here, 'client.next.js');

const bundle = await readFile(source, 'utf8');
const template = await readFile(join(here, 'client.template.js'), 'utf8');

const literal = (name) => {
  const match = bundle.match(new RegExp('const ' + name + ' = (.*);\\r?\\n'));
  if (!match) throw new Error('existing bundle lost const ' + name);
  return match[1];
};

const video = literal('VIDEO_URI');
const loop = literal('LOOP_URI');
const paths = literal('SKETCH_PATHS');
const logo = literal('LOGO_PARTS');

const replacements = [
  ["'__DSHSK_VIDEO__'", video],
  ["'__DSHSK_LOOP__'", loop],
  ['__DSHSK_PATHS__', paths],
  ['__DSHSK_LOGO_PARTS__', logo],
];

let output = template;
for (const [placeholder, value] of replacements) {
  const count = output.split(placeholder).length - 1;
  if (count !== 1) throw new Error(`client.template.js should contain ${placeholder} once, found ${count}`);
  output = output.replace(placeholder, () => value);
}
await writeFile(target, output);
console.log(`${basename(source)} -> ${basename(target)}: ${output.length} chars (video ${video.length}, loop ${loop.length}, strokes ${JSON.parse(paths).paths.length})`);
