// Собирает www/ для Capacitor: всё, что нужно игре в рантайме. Без npm-зависимостей игры (three.js лежит в assets/).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www');
const items = ['index.html', 'manifest.webmanifest', 'legal.html', 'test3d.html', 'css', 'src', 'assets', 'icones'];
fs.rmSync(www, { recursive: true, force: true });
for (const it of items) fs.cpSync(path.join(root, it), path.join(www, it), { recursive: true });
console.log('www готов:', items.join(', '));
