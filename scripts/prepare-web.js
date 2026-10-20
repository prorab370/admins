// Собирает www/: приложение + Three.js (ядро и только НУЖНЫЕ addons — по замыканию импортов app.js).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www'), three = path.join(root, 'node_modules', 'three'), jsm = path.join(three, 'examples', 'jsm');
const cp = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
if (!fs.existsSync(jsm)) { console.error('three не установлен: выполни npm install'); process.exit(1); }
fs.rmSync(www, { recursive: true, force: true });
cp(path.join(root, 'index.html'), path.join(www, 'index.html'));
cp(path.join(root, 'src', 'app.js'), path.join(www, 'src', 'app.js'));
cp(path.join(root, 'models', 'engine.glb'), path.join(www, 'models', 'engine.glb'));
for (const dn of ['sounds', 'lib', 'fonts']) for (const f of fs.readdirSync(path.join(root, dn))) cp(path.join(root, dn, f), path.join(www, dn, f));
cp(path.join(root, 'icon.png'), path.join(www, 'icon.png'));
for (const f of fs.readdirSync(path.join(three, 'build'))) if (/^three\.(module|core)\.js$/.test(f)) cp(path.join(three, 'build', f), path.join(www, 'vendor', f));
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8'), seen = new Set(), queue = [];
for (const m of app.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) queue.push(path.join(jsm, m[1]));
while (queue.length) {
  const f = queue.pop(); if (seen.has(f)) continue;
  if (!fs.existsSync(f)) { console.error('не найден аддон:', f); process.exit(1); }
  seen.add(f);
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) { const t = path.resolve(path.dirname(f), m[1]); if (t.startsWith(jsm)) queue.push(t); }
}
for (const f of seen) cp(f, path.join(www, 'vendor', 'jsm', path.relative(jsm, f)));
const dr = path.join(jsm, 'libs', 'draco', 'gltf'); if (fs.existsSync(dr)) for (const f of fs.readdirSync(dr)) cp(path.join(dr, f), path.join(www, 'vendor', 'jsm', 'libs', 'draco', 'gltf', f));
console.log('www готов: addons —', seen.size, 'файлов');
