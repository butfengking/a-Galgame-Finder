// 将 PNG 转为多尺寸 .ico（用于 exe / 窗口图标）。
// 运行：node convert-icon.js <源图片> [输出路径]
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');
const path = require('path');

const src = process.argv[2] || 'C:\\Users\\PC\\Pictures\\m3.png';
const outFile = process.argv[3] || path.join(__dirname, 'build', 'icon.ico');

(async () => {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const base = await sharp(src)
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    pngs.push(await sharp(base).resize(s, s).png().toBuffer());
  }
  const ico = await pngToIco(pngs);
  fs.writeFileSync(outFile, ico);
  console.log('OK 已生成:', outFile, '(' + Math.round(ico.length / 1024) + ' KB)');
})().catch((e) => {
  console.error('转换失败:', e && e.message ? e.message : e);
  process.exit(1);
});
