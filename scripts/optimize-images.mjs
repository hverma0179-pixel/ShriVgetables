import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceDir = path.join(root, 'public', 'products', 'vegetables');
const backupDir = path.join(root, 'image-originals');
const files = (await fs.readdir(sourceDir)).filter(file => /\.(jpe?g|png)$/i.test(file));
await fs.mkdir(backupDir, { recursive: true });

for (const file of files) {
  const source = path.join(sourceDir, file);
  const target = path.join(sourceDir, file.replace(/\.(jpe?g|png)$/i, '.webp'));
  await sharp(source)
    .rotate()
    .resize({ width: 1200, height: 900, fit: 'cover', position: 'attention', withoutEnlargement: true })
    .webp({ quality: 78, effort: 5 })
    .toFile(target);
  await fs.rename(source, path.join(backupDir, file));
}
console.log(`Optimized ${files.length} images and moved originals to ${backupDir}`);