import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const tpl = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
const three = fs
  .readFileSync(path.join(here, 'three.min.js'), 'utf8')
  .replace(/\/\/# sourceMappingURL=.*$/gm, '')
  .replace(/<\/script/gi, '<\\/script');
const jsFiles = ['00-core.js', '10-world.js', '20-mission.js'];
const app = jsFiles
  .map((f) => `/* ---- ${f} ---- */\n` + fs.readFileSync(path.join(src, f), 'utf8'))
  .join('\n')
  .replace(/<\/script/gi, '<\\/script');

let out = tpl.replace('/*__CSS__*/', css).replace('/*__THREE__*/', three).replace('/*__APP__*/', app);
out = out.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, 'http://www.w3.org/2000/svg');

const target = path.join(here, 'index.html');
fs.writeFileSync(target, out, 'utf8');
console.log(`Built ${target} (${(out.length / 1024).toFixed(0)} KB)`);
