const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const desktopDir = path.join(os.homedir(), 'Desktop', 'cancha-pago');
if (!fs.existsSync(desktopDir)) {
  fs.mkdirSync(desktopDir, { recursive: true });
}

const files = ['server.js', 'index.html', 'app.js', 'styles.css', 'package.json', 'data.json'];
files.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(desktopDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
});

console.log('Carpeta creada en el Escritorio con exito:', desktopDir);

try {
  execSync(`explorer "${desktopDir}"`);
} catch (e) {}
