const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { clean, resolveConfig } = require('../');
const { makeTmpDir, writeTree, exists, cleanup } = require('./helpers');

const bin = path.resolve(__dirname, '../bin/dfcleaner.js');

const runCli = (args, cwd) =>
  execFileSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

test('多根目录：跨根识别重复并按 preferDirs 保留', async () => {
  const rootA = makeTmpDir('dfc-root-a-');
  const rootB = makeTmpDir('dfc-root-b-');
  try {
    writeTree(rootA, { 'a.txt': 'same' });
    writeTree(rootB, { 'a.txt': 'same' });

    const result = await clean({
      baseDirs: [rootA, rootB],
      configPath: null,
      dryRun: false,
      preferDirs: [rootB],
    });

    assert.deepStrictEqual(result.roots, [path.resolve(rootA), path.resolve(rootB)]);
    assert.strictEqual(result.stats.totalFiles, 2);
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(result.stats.deletedFiles, 1);
    assert.ok(exists(path.join(rootB, 'a.txt')));
    assert.ok(!exists(path.join(rootA, 'a.txt')));
  } finally {
    cleanup(rootA);
    cleanup(rootB);
  }
});

test('多根目录：relPath 带根标签且保留 root 字段', async () => {
  const rootA = makeTmpDir('dfc-root-a-');
  const rootB = makeTmpDir('dfc-root-b-');
  try {
    writeTree(rootA, { 'sub/a.txt': 'same' });
    writeTree(rootB, { 'sub/a.txt': 'same' });

    const result = await clean({
      baseDirs: [rootA, rootB],
      configPath: null,
    });

    const files = result.groups[0].files;
    assert.strictEqual(files.length, 2);
    assert.strictEqual(new Set(files.map((file) => file.root)).size, 2);

    for (const file of files) {
      assert.match(file.relPath, /^[^/]+\/sub\/a\.txt$/);
      assert.strictEqual(file.root, path.dirname(path.dirname(file.path)));
    }
  } finally {
    cleanup(rootA);
    cleanup(rootB);
  }
});

test('多根目录：重复目录跨根检测', async () => {
  const rootA = makeTmpDir('dfc-root-a-');
  const rootB = makeTmpDir('dfc-root-b-');
  try {
    writeTree(rootA, { 'pack/a.txt': 'x', 'pack/sub/b.txt': 'y' });
    writeTree(rootB, { 'pack/a.txt': 'x', 'pack/sub/b.txt': 'y' });

    const result = await clean({
      baseDirs: [rootA, rootB],
      configPath: null,
      detect: 'dir',
      dryRun: false,
      preferDirs: [path.join(rootB, 'pack')],
    });

    assert.strictEqual(result.dirGroups.length, 1);
    assert.strictEqual(result.dirGroups[0].keep.length, 1);
    assert.ok(exists(path.join(rootB, 'pack', 'a.txt')));
    assert.ok(!exists(path.join(rootA, 'pack')));
  } finally {
    cleanup(rootA);
    cleanup(rootB);
  }
});

test('多根目录：空目录清理不会删除根目录自身', async () => {
  const rootA = makeTmpDir('dfc-root-a-');
  const rootB = makeTmpDir('dfc-root-b-');
  try {
    const fs = require('node:fs');
    fs.mkdirSync(path.join(rootA, 'empty'), { recursive: true });
    fs.mkdirSync(path.join(rootB, 'empty'), { recursive: true });

    const result = await clean({ baseDirs: [rootA, rootB], configPath: null, dryRun: false });

    assert.strictEqual(result.stats.emptyDirsRemoved, 2);
    assert.ok(exists(rootA));
    assert.ok(exists(rootB));
    assert.ok(!exists(path.join(rootA, 'empty')));
    assert.ok(!exists(path.join(rootB, 'empty')));
  } finally {
    cleanup(rootA);
    cleanup(rootB);
  }
});

test('baseDirs 配置：去重、解析为绝对路径、baseDir 取首个', () => {
  const dir = makeTmpDir();
  try {
    const config = resolveConfig({
      baseDirs: [dir, dir, path.join(dir, 'sub')],
      configPath: null,
    });

    assert.strictEqual(config.baseDirs.length, 2);
    assert.strictEqual(config.baseDirs[0], path.resolve(dir));
    assert.strictEqual(config.baseDir, config.baseDirs[0]);
    assert.strictEqual(config.baseDirs[1], path.resolve(dir, 'sub'));
  } finally {
    cleanup(dir);
  }
});

test('CLI 支持重复 -d 指定多个根目录', () => {
  const rootA = makeTmpDir('dfc-root-a-');
  const rootB = makeTmpDir('dfc-root-b-');
  try {
    writeTree(rootA, { 'a.txt': 'same' });
    writeTree(rootB, { 'a.txt': 'same' });

    const result = JSON.parse(
      runCli(['-d', rootA, '-d', rootB, '-y', '--prefer', rootB, '--json', '-q'], rootA)
    );

    assert.strictEqual(result.roots.length, 2);
    assert.strictEqual(result.stats.removableFiles, 1);
    assert.ok(exists(path.join(rootB, 'a.txt')));
    assert.ok(!exists(path.join(rootA, 'a.txt')));
  } finally {
    cleanup(rootA);
    cleanup(rootB);
  }
});

test('单根目录行为保持兼容（relPath 不带标签）', async () => {
  const root = makeTmpDir('dfc-root-');
  try {
    writeTree(root, { 'a.txt': 'same', 'sub/b.txt': 'same' });

    const result = await clean({ baseDir: root, configPath: null });

    const relPaths = result.groups[0].files.map((file) => file.relPath).sort();
    assert.deepStrictEqual(relPaths, ['a.txt', 'sub/b.txt']);
  } finally {
    cleanup(root);
  }
});
