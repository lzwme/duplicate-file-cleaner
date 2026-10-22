const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveConfig, getConfig, DEFAULT_CONFIG, normalizeRules } = require('../');
const { makeTmpDir, cleanup } = require('./helpers');

test('默认配置为预览模式，且每次返回独立对象', () => {
  const first = getConfig();
  const second = getConfig();

  assert.strictEqual(first.dryRun, true);
  assert.notStrictEqual(first, second);

  first.baseDir = path.join('nope', 'x');
  assert.notStrictEqual(second.baseDir, first.baseDir);
});

test('getConfig 支持 README 中的对象参数（修复 v1 首参语义）', () => {
  const dir = makeTmpDir();
  try {
    const config = getConfig({ baseDir: dir, keep: 2, configPath: null });

    assert.strictEqual(config.baseDir, path.resolve(dir));
    assert.strictEqual(config.keep, 2);
  } finally {
    cleanup(dir);
  }
});

test('字符串规则被归一化为 glob 正则（不再崩溃）', () => {
  const config = resolveConfig(
    { baseDir: process.cwd(), configPath: null, exclude: ['.git', '*.log'] },
    { cwd: process.cwd() }
  );

  assert.strictEqual(config.exclude.length, 2);
  assert.ok(config.exclude[0].test('.git/config'));
  assert.ok(config.exclude[1].test('logs/a.log'));
  assert.ok(!config.exclude[1].test('logs/a.txt'));
});

test('正则规则会去掉 g 标志，避免 lastIndex 状态残留', () => {
  const rules = normalizeRules([/\.log$/g]);
  assert.ok(rules[0].test('a.log'));
  assert.ok(rules[0].test('b.log'));
});

test('历史配置项被映射并给出告警', () => {
  const warnings = [];
  const config = resolveConfig(
    {
      baseDir: process.cwd(),
      configPath: null,
      isSilent: true,
      fileMinSize: 2,
      deleteMinSizeFiles: undefined,
    },
    { cwd: process.cwd(), warn: (message) => warnings.push(message) }
  );

  assert.strictEqual(config.silent, true);
  assert.strictEqual(config.minFileSize, 2048);
  assert.strictEqual(config.deleteMinSizeFiles, false);
  assert.ok(warnings.length >= 2);
});

test('配置优先级：默认值 < 配置文件 < 显式参数', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(
      path.join(dir, '.dfcleaner.config.js'),
      'module.exports = { keep: 3, silent: true, dryRun: false, baseDir: __dirname };'
    );

    const config = resolveConfig({ keep: 2 }, { cwd: dir });

    assert.strictEqual(config.keep, 2, '显式参数应覆盖配置文件');
    assert.strictEqual(config.silent, true, '配置文件应覆盖默认值');
    assert.strictEqual(config.dryRun, false);
    assert.ok(config.configPath.endsWith('.dfcleaner.config.js'));
    assert.strictEqual(config.baseDir, path.resolve(dir));
  } finally {
    cleanup(dir);
  }
});

test('configPath 为 null 时不加载配置文件', () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, '.dfcleaner.config.js'), 'module.exports = { keep: 9 };');
    const config = resolveConfig({ configPath: null }, { cwd: dir });

    assert.strictEqual(config.keep, 1);
    assert.strictEqual(config.configPath, null);
  } finally {
    cleanup(dir);
  }
});

test('非法配置会抛出明确错误', () => {
  assert.throws(
    () => resolveConfig({ configPath: null, keepStrategy: 'whatever' }),
    /非法的保留策略/
  );
  assert.throws(() => resolveConfig({ configPath: null, algorithm: 'nope' }), /不支持的哈希算法/);
  assert.throws(() => resolveConfig({ configPath: null, maxDepth: -5 }), /maxDepth/);
});

test('默认排除规则覆盖 .git 与 node_modules', () => {
  assert.ok(DEFAULT_CONFIG.exclude.some((rule) => rule.test('.git/config')));
  assert.ok(DEFAULT_CONFIG.exclude.some((rule) => rule.test('a/node_modules/b.js')));
});
