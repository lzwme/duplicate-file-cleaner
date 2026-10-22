const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { makeTmpDir, writeTree, listTree, exists, cleanup } = require('./helpers');

const bin = path.resolve(__dirname, '../bin/dfcleaner.js');

const runCli = (args, cwd) =>
  execFileSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const runCliRaw = (args, cwd) =>
  spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });

test('CLI 默认只预览，不修改文件', () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'sub/b.txt': 'same' });

    const result = JSON.parse(runCli(['-d', dir, '--json', '-q'], dir));

    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.deleted[0].status, 'planned');
    assert.ok(exists(path.join(dir, 'sub', 'b.txt')));
  } finally {
    cleanup(dir);
  }
});

test('CLI --yes 执行真实删除，并清理空目录', () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'same', 'sub/b.txt': 'same' });

    const result = JSON.parse(runCli(['-d', dir, '-y', '--json', '-q'], dir));

    assert.strictEqual(result.dryRun, false);
    assert.strictEqual(result.stats.deletedFiles, 1);
    assert.deepStrictEqual(listTree(dir), ['a.txt']);
  } finally {
    cleanup(dir);
  }
});

test('CLI --no-compare-all-dir 可真正关闭跨目录比较', () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'd1/x.txt': 'dup', 'd1/y.txt': 'dup', 'd2/x.txt': 'dup' });

    const result = JSON.parse(runCli(['-d', dir, '-y', '--no-compare-all-dir', '--json', '-q'], dir));

    assert.strictEqual(result.config.compareAllDir, false);
    assert.strictEqual(result.stats.removableFiles, 1);
    assert.ok(exists(path.join(dir, 'd2', 'x.txt')));
  } finally {
    cleanup(dir);
  }
});

test('CLI 使用 --min-file-size 跳过小文件', () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'a.txt': 'x', 'b.txt': 'x' });

    const result = JSON.parse(runCli(['-d', dir, '-y', '--min-file-size', '1kb', '--json', '-q'], dir));

    assert.strictEqual(result.config.minFileSize, 1024);
    assert.strictEqual(result.groups.length, 0);
    assert.strictEqual(result.stats.deletedFiles, 0);
  } finally {
    cleanup(dir);
  }
});

test('CLI 目录不存在时返回非零退出码', () => {
  const dir = makeTmpDir();
  try {
    const result = runCliRaw(['-d', path.join(dir, 'missing'), '-q'], dir);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /指定的目录不存在/);
  } finally {
    cleanup(dir);
  }
});

test('CLI 无参数时展示帮助且不扫描目录', () => {
  const dir = makeTmpDir();
  try {
    const result = runCliRaw([], dir);
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /Usage: dfcleaner/);
    assert.doesNotMatch(result.stdout, /\[重复组\]/);
  } finally {
    cleanup(dir);
  }
});
