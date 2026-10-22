const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** 创建隔离的临时目录 */
const makeTmpDir = (prefix = 'dfc-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** 写入文件并自动创建父目录 */
const writeFile = (filePath, content = '') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

/** 按 { 相对路径: 内容 } 批量创建文件 */
const writeTree = (root, tree) => {
  for (const [relative, content] of Object.entries(tree)) {
    writeFile(path.join(root, relative), content);
  }
};

/** 递归列出目录下的所有相对路径 */
const listTree = (root) =>
  fs
    .readdirSync(root, { recursive: true })
    .map((item) => item.replace(/\\/g, '/'))
    .sort();

const exists = (filePath) => fs.existsSync(filePath);

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

module.exports = { makeTmpDir, writeFile, writeTree, listTree, exists, cleanup };
