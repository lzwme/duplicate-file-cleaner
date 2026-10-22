const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { clean, detectDuplicates, resolveConfig } = require('../');
const { makeTmpDir, writeFile, writeTree, listTree, exists, cleanup } = require('./helpers');

const baseConfig = (dir) => ({ baseDir: dir, configPath: null });

test('默认预览：识别重复但不修改磁盘', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'sub/b.txt': 'same' });

    const result = await clean(baseConfig(dir));

    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(result.stats.removableFiles, 1);
    assert.strictEqual(result.deleted.length, 1);
    assert.strictEqual(result.deleted[0].status, 'planned');
    assert.strictEqual(result.stats.deletedFiles, 0);
    assert.ok(exists(path.join(dir, 'a.txt')));
    assert.ok(exists(path.join(dir, 'sub', 'b.txt')));
  } finally {
    cleanup(dir);
  }
});

test('确认执行：按 shortest-path 保留，删除其余副本', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'sub/b.txt': 'same' });

    const result = await clean({ ...baseConfig(dir), dryRun: false, keepStrategy: 'shortest-path' });

    assert.strictEqual(result.stats.deletedFiles, 1);
    assert.ok(result.stats.deletedBytes > 0);
    assert.ok(exists(path.join(dir, 'a.txt')));
    assert.ok(!exists(path.join(dir, 'sub', 'b.txt')));
  } finally {
    cleanup(dir);
  }
});

test('keep=2 时保留两份', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'b.txt': 'same', 'c.txt': 'same' });

    const result = await clean({ ...baseConfig(dir), dryRun: false, keep: 2 });

    assert.strictEqual(result.stats.removableFiles, 1);
    assert.strictEqual(result.stats.deletedFiles, 1);
    assert.strictEqual(listTree(dir).length, 2);
  } finally {
    cleanup(dir);
  }
});

test('preferDirs 优先保留指定目录', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'copy-dir/a.txt': 'same', 'keep-dir/a.txt': 'same' });

    await clean({
      ...baseConfig(dir),
      dryRun: false,
      keepStrategy: 'first',
      preferDirs: [path.join(dir, 'keep-dir')],
    });

    assert.ok(exists(path.join(dir, 'keep-dir', 'a.txt')));
    assert.ok(!exists(path.join(dir, 'copy-dir', 'a.txt')));
  } finally {
    cleanup(dir);
  }
});

test('compareAllDir=false 时不做跨目录去重', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'd1/x.txt': 'dup', 'd1/y.txt': 'dup', 'd2/x.txt': 'dup' });

    const result = await clean({ ...baseConfig(dir), dryRun: false, compareAllDir: false });

    assert.strictEqual(result.stats.removableFiles, 1);
    assert.ok(exists(path.join(dir, 'd1', 'x.txt')));
    assert.ok(!exists(path.join(dir, 'd1', 'y.txt')));
    assert.ok(exists(path.join(dir, 'd2', 'x.txt')));
  } finally {
    cleanup(dir);
  }
});

test('空目录被清理，但 baseDir 自身保留', async () => {
  const dir = makeTmpDir();
  try {
    fs.mkdirSync(path.join(dir, 'empty'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'nested', 'deep'), { recursive: true });

    const result = await clean({ ...baseConfig(dir), dryRun: false });

    assert.ok(result.stats.emptyDirsRemoved >= 3);
    assert.ok(exists(dir));
    assert.deepStrictEqual(listTree(dir), []);
  } finally {
    cleanup(dir);
  }
});

test('minFileSize 只用于跳过，不删除文件', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'x', 'b.txt': 'x' });

    const result = await clean({ ...baseConfig(dir), dryRun: false, minFileSize: 10 });

    assert.strictEqual(result.groups.length, 0);
    assert.strictEqual(result.stats.skippedSmallFiles, 2);
    assert.ok(exists(path.join(dir, 'a.txt')));
    assert.ok(exists(path.join(dir, 'b.txt')));
  } finally {
    cleanup(dir);
  }
});

test('deleteMinSizeFiles 为显式开关，关闭时不删除唯一小文件', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'small.txt': 'x', 'big.txt': 'y'.repeat(100) });

    const preview = await clean({ ...baseConfig(dir), dryRun: false, minFileSize: 10 });
    assert.ok(exists(path.join(dir, 'small.txt')));

    const result = await clean({
      ...baseConfig(dir),
      dryRun: false,
      minFileSize: 10,
      deleteMinSizeFiles: true,
    });

    assert.strictEqual(result.stats.deletedFiles, 1);
    assert.ok(!exists(path.join(dir, 'small.txt')));
    assert.strictEqual(preview.stats.deletedFiles, 0);
  } finally {
    cleanup(dir);
  }
});

test('trashDir 模式下文件被移动而非删除', async () => {
  const dir = makeTmpDir();
  const trash = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'sub/b.txt': 'same' });

    const result = await clean({
      ...baseConfig(dir),
      dryRun: false,
      keepStrategy: 'shortest-path',
      trashDir: trash,
    });

    assert.strictEqual(result.deleted[0].status, 'trashed');
    assert.ok(!exists(path.join(dir, 'sub', 'b.txt')));
    assert.ok(exists(path.join(trash, 'sub', 'b.txt')));
  } finally {
    cleanup(dir);
    cleanup(trash);
  }
});

test('.dfcleanerignore 生效', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, {
      '.dfcleanerignore': '*.log\n',
      'a.log': 'same',
      'b.log': 'same',
      'c.txt': 'same',
    });

    const result = await clean(baseConfig(dir));

    assert.strictEqual(result.stats.totalFiles, 1);
    assert.strictEqual(result.groups.length, 0);
  } finally {
    cleanup(dir);
  }
});

test('报告文件包含分组与统计', async () => {
  const dir = makeTmpDir();
  const reportDir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'b.txt': 'same' });
    const reportFile = path.join(reportDir, 'report.json');

    await clean({ ...baseConfig(dir), reportFile });

    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    assert.strictEqual(report.groups.length, 1);
    assert.strictEqual(report.groups[0].keep.length, 1);
    assert.strictEqual(report.groups[0].remove.length, 1);
    assert.strictEqual(report.stats.removableFiles, 1);
  } finally {
    cleanup(dir);
    cleanup(reportDir);
  }
});

test('maxDeleteRatio 超限时中止且不删除任何文件', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'b.txt': 'same', 'c.txt': 'same', 'd.txt': 'same' });

    await assert.rejects(
      () => clean({ ...baseConfig(dir), dryRun: false, maxDeleteRatio: 0.5 }),
      /超过比例上限/
    );

    assert.strictEqual(listTree(dir).length, 4);
  } finally {
    cleanup(dir);
  }
});

test('目录不存在或为根目录时给出明确错误', async () => {
  const dir = makeTmpDir();
  try {
    await assert.rejects(
      () => clean({ baseDir: path.join(dir, 'missing'), configPath: null }),
      /指定的目录不存在/
    );
  } finally {
    cleanup(dir);
  }

  const root = path.parse(process.cwd()).root;
  await assert.rejects(() => clean({ baseDir: root, configPath: null }), /拒绝以文件系统根目录/);
});

test('detectDuplicates 按 size 预筛，不读取不同尺寸文件', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'b.txt': 'same', 'c.txt': 'different-size' });
    const config = resolveConfig({ ...baseConfig(dir) }, { cwd: dir });

    const errors = [];
    const groups = await detectDuplicates(
      [
        { path: path.join(dir, 'a.txt'), relPath: 'a.txt', name: 'a.txt', size: 4, mtimeMs: 1, ino: 1, dev: 1, isSymlink: false },
        { path: path.join(dir, 'b.txt'), relPath: 'b.txt', name: 'b.txt', size: 4, mtimeMs: 2, ino: 2, dev: 1, isSymlink: false },
        { path: path.join(dir, 'c.txt'), relPath: 'c.txt', name: 'c.txt', size: 13, mtimeMs: 3, ino: 3, dev: 1, isSymlink: false },
      ],
      config,
      errors
    );

    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].files.length, 2);
    assert.strictEqual(errors.length, 0);
  } finally {
    cleanup(dir);
  }
});
