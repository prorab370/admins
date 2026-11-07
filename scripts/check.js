// Быстрая проверка проекта: синтаксис всех .js и наличие всех файлов, на которые ссылаются index.html и style.css.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..'); let bad = 0;
const rel = (...a) => path.join(root, ...a);
function walk(d, out = []) { for (const f of fs.readdirSync(d, { withFileTypes: true })) {
  if (['node_modules', 'android', 'www', '.git', 'native'].includes(f.name)) continue;
  const p = path.join(d, f.name); f.isDirectory() ? walk(p, out) : out.push(p); } return out; }
for (const f of walk(root).filter(f => f.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); }
  catch (e) { bad++; console.error('СИНТАКСИС:', path.relative(root, f), '-', e.message); }
}
const html = fs.readFileSync(rel('index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
for (const m of html.matchAll(/(?:src|href)="([^"#?:]+)"/g)) if (!fs.existsSync(rel(m[1]))) { bad++; console.error('НЕТ ФАЙЛА (index.html):', m[1]); }
const css = fs.readFileSync(rel('css', 'style.css'), 'utf8');
for (const m of css.matchAll(/url\(\s*['"]?([^)'"]+)/g)) if (!/^data:/.test(m[1]) && !fs.existsSync(rel('css', m[1]))) { bad++; console.error('НЕТ ФАЙЛА (style.css):', m[1]); }
// Языки, объявленные в src/lang-loader.js (SM_LANGUES_NOUVELLES): для каждого должен быть assets/langues/<код>.js
const ll = fs.readFileSync(rel('src', 'lang-loader.js'), 'utf8').match(/SM_LANGUES_NOUVELLES\s*=\s*\{([^}]*)\}/);
if (ll) for (const m of ll[1].matchAll(/(\w+)\s*:\s*1/g)) if (!fs.existsSync(rel('assets', 'langues', m[1] + '.js'))) { bad++; console.error('НЕТ ЯЗЫКА:', 'assets/langues/' + m[1] + '.js'); }
// Файл, который игра грузит по необходимости
if (!fs.existsSync(rel('assets', 'generateur.js'))) { bad++; console.error('НЕТ ФАЙЛА: assets/generateur.js'); }
console.log(bad ? 'Ошибок: ' + bad : 'OK: синтаксис и ссылки в порядке');
process.exit(bad ? 1 : 0);
