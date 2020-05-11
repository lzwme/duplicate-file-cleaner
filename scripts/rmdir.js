
const path = require('path');
const fs = require('fs');

const rmdir = (dir) => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;

  const fileList = fs.readdirSync(dir);

  for (let filename of fileList) {
    if (!filename || ['.', '..'].includes(filename)) continue;

    const filePath = path.resolve(dir, filename);
    const fileStat = fs.statSync(filePath);

    if (fileStat.isDirectory()) {
      rmdir(filePath);
      continue;
    }

    if (fileStat.isFile()) fs.unlinkSync(filePath);
  }
}

const start = () => {
  const dest = path.resolve((process.argv[2] || './').trim());

  if (!fs.existsSync(dest)) {
    console.log('指定的目录不存在：', dest);
    return;
  }

  rmdir(dest);
  console.log('目录已删除：', dest);
}

start();
