const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Jimp } = require('jimp');
const {
  clean,
  resolveConfig,
  imageHash,
  hammingDistance,
  restoreFromTrash,
} = require('../');
const { makeTmpDir, writeFile, writeTree, exists, cleanup } = require('./helpers');

const baseConfig = (dir) => ({ baseDir: dir, configPath: null });

const makeImage = async (filePath, inverted, rightColor = 0xeeeeeeff) => {
  const image = new Jimp({ width: 32, height: 32, color: 0xffffffff });

  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 32; y++) {
      image.setPixelColor(inverted ? rightColor : 0x202020ff, x, y);
      image.setPixelColor(inverted ? 0x202020ff : rightColor, x + 16, y);
    }
  }

  await image.write(filePath);
};

test('硬链接不会被重复删除，也不计入可释放空间', async () => {
  const dir = makeTmpDir();
  try {
    const first = path.join(dir, 'a.bin');
    writeFile(first, 'same-content');
    fs.linkSync(first, path.join(dir, 'b.bin'));

    const result = await clean({ ...baseConfig(dir), dryRun: false });

    assert.strictEqual(result.stats.deletedFiles, 0);
    assert.strictEqual(result.stats.hardlinksSkipped, 1);
    assert.ok(exists(path.join(dir, 'a.bin')));
    assert.ok(exists(path.join(dir, 'b.bin')));
  } finally {
    cleanup(dir);
  }
});

test('哈希缓存：二次运行命中，mtime 变化后失效', async () => {
  const dir = makeTmpDir();
  const cacheDir = makeTmpDir();
  const cacheFile = path.join(cacheDir, 'hash-cache.json');
  try {
    writeTree(dir, { 'a.txt': 'same', 'b.txt': 'same' });

    const first = await clean({ ...baseConfig(dir), cacheFile });
    assert.strictEqual(first.stats.cacheHits, 0);
    assert.ok(exists(cacheFile));

    const second = await clean({ ...baseConfig(dir), cacheFile });
    assert.strictEqual(second.stats.cacheHits, 2);

    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(dir, 'a.txt'), future, future);

    const third = await clean({ ...baseConfig(dir), cacheFile });
    assert.strictEqual(third.stats.cacheHits, 1);
    assert.strictEqual(third.groups.length, 1);
  } finally {
    cleanup(dir);
    cleanup(cacheDir);
  }
});

test('重复目录检测与整目录清理', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, {
      'keep/a.txt': 'alpha',
      'keep/sub/b.txt': 'beta',
      'copy/a.txt': 'alpha',
      'copy/sub/b.txt': 'beta',
    });

    const result = await clean({
      ...baseConfig(dir),
      detect: 'dir',
      dryRun: false,
      preferDirs: [path.join(dir, 'keep')],
    });

    assert.strictEqual(result.dirGroups.length, 1);
    assert.strictEqual(result.dirGroups[0].keep.length, 1);
    assert.strictEqual(result.dirGroups[0].keep[0], path.join(dir, 'keep'));
    assert.ok(exists(path.join(dir, 'keep', 'a.txt')));
    assert.ok(!exists(path.join(dir, 'copy')));
  } finally {
    cleanup(dir);
  }
});

test('exact 模式不执行目录检测，both 模式两者都做', async () => {
  const dir = makeTmpDir();
  try {
    writeTree(dir, { 'keep/a.txt': 'x', 'copy/a.txt': 'x' });

    const exact = await clean({ ...baseConfig(dir), detect: 'exact' });
    assert.strictEqual(exact.dirGroups.length, 0);

    const both = await clean({ ...baseConfig(dir), detect: 'both' });
    assert.strictEqual(both.dirGroups.length, 1);
  } finally {
    cleanup(dir);
  }
});

test('相似图片：dHash 聚类并默认只报告', async () => {
  const dir = makeTmpDir();
  try {
    // b 的亮部略暗：视觉相似但字节不同，避免被精确去重命中
    await makeImage(path.join(dir, 'a.png'), false);
    await makeImage(path.join(dir, 'b.png'), false, 0xe8e8e8ff);
    await makeImage(path.join(dir, 'c.png'), true);

    const hashA = await imageHash(path.join(dir, 'a.png'));
    const hashB = await imageHash(path.join(dir, 'b.png'));
    const hashC = await imageHash(path.join(dir, 'c.png'));

    assert.ok(hammingDistance(hashA, hashB) <= 1);
    assert.ok(hammingDistance(hashA, hashC) > 1);

    const result = await clean({
      ...baseConfig(dir),
      similarImages: true,
      similarThreshold: 1,
      dryRun: false,
    });

    assert.strictEqual(result.similarGroups.length, 1);
    assert.strictEqual(result.similarGroups[0].files.length, 2);
    assert.strictEqual(result.stats.deletedFiles, 0);
    assert.ok(exists(path.join(dir, 'a.png')));
  } finally {
    cleanup(dir);
  }
});

test('--delete-similar 开启后才删除相似图片', async () => {
  const dir = makeTmpDir();
  try {
    await makeImage(path.join(dir, 'a.png'), false);
    await makeImage(path.join(dir, 'b.png'), false, 0xe8e8e8ff);

    const result = await clean({
      ...baseConfig(dir),
      similarImages: true,
      similarThreshold: 1,
      deleteSimilarImages: true,
      dryRun: false,
      keepStrategy: 'shortest-path',
    });

    assert.strictEqual(result.stats.deletedFiles, 1);
    assert.ok(exists(path.join(dir, 'a.png')));
    assert.ok(!exists(path.join(dir, 'b.png')));
  } finally {
    cleanup(dir);
  }
});

test('回收站清单可用于还原', async () => {
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

    const preview = await restoreFromTrash(trash, { dryRun: true });
    assert.strictEqual(preview.restored.length, 1);
    assert.ok(!exists(path.join(dir, 'sub', 'b.txt')));

    const restored = await restoreFromTrash(trash, { dryRun: false });
    assert.strictEqual(restored.restored.length, 1);
    assert.ok(exists(path.join(dir, 'sub', 'b.txt')));
  } finally {
    cleanup(dir);
    cleanup(trash);
  }
});

test('新配置项默认值与校验', () => {
  const config = resolveConfig({ configPath: null });

  assert.strictEqual(config.detect, 'exact');
  assert.strictEqual(config.similarImages, false);
  assert.strictEqual(config.deleteSimilarImages, false);
  assert.strictEqual(config.similarThreshold, 5);
  assert.strictEqual(config.cacheFile, null);
  assert.strictEqual(config.progress, true);

  assert.strictEqual(resolveConfig({ configPath: null, similarThreshold: 100 }).similarThreshold, 64);
  assert.throws(() => resolveConfig({ configPath: null, detect: 'nope' }), /非法的检测模式/);
});
