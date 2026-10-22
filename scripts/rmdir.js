/**
 * 递归删除目录（仅用于清理构建产物）。
 * 出于安全考虑，只允许删除当前工作目录之下的子目录。
 */
const fs = require('node:fs');
const path = require('node:path');

const cwd = process.cwd();
const target = path.resolve(process.argv[2] || '');

if (!process.argv[2]) {
  console.error('用法: node scripts/rmdir.js <dir>');
  process.exit(1);
}

const relative = path.relative(cwd, target);

if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  console.error(`拒绝删除工作目录之外的路径：${target}`);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  console.log('目录不存在，跳过：', target);
  process.exit(0);
}

fs.rmSync(target, { recursive: true, force: true });
console.log('目录已删除：', target);
