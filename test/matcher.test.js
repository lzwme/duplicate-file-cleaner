const { test } = require('node:test');
const assert = require('node:assert');
const { globToRegExp, createMatcher, normalizeRules, Ignorer } = require('../');

test('glob 转换', () => {
  assert.ok(globToRegExp('*.log').test('a/b.log'));
  assert.ok(globToRegExp('*.log').test('a.log'));
  assert.ok(!globToRegExp('*.log').test('a/b.txt'));
  assert.ok(globToRegExp('**/*.log').test('x/y/z.log'));
  assert.ok(globToRegExp('**/*.log').test('z.log'));
  assert.ok(globToRegExp('.git').test('.git/config'));
  assert.ok(globToRegExp('node_modules').test('packages/x/node_modules/y.js'));
  assert.ok(globToRegExp('docs/**').test('docs/a/b'));
  assert.ok(globToRegExp('file?.txt').test('file1.txt'));
  assert.ok(!globToRegExp('file?.txt').test('file10.txt'));
});

test('glob 中的正则元字符被转义', () => {
  assert.doesNotThrow(() => globToRegExp('a[b'));
  assert.ok(globToRegExp('a[b').test('a[b'));
  assert.ok(!globToRegExp('a[b').test('ab'));
});

test('matcher：排除优先，白名单为空时全部通过', () => {
  const matcher = createMatcher([], normalizeRules(['node_modules', '*.tmp']));

  assert.ok(matcher.matches('src/index.ts'));
  assert.ok(!matcher.matches('node_modules/x/index.js'));
  assert.ok(!matcher.matches('a/b.tmp'));

  const whitelist = createMatcher(normalizeRules(['**/*.jpg']), []);
  assert.ok(whitelist.matches('a/b.jpg'));
  assert.ok(!whitelist.matches('a/b.png'));
});

test('ignorer：后出现的规则优先，支持 ! 取反', () => {
  const ignorer = new Ignorer();
  ignorer.add('*.tmp');
  ignorer.add('!keep.tmp');

  assert.ok(ignorer.ignores('a.tmp'));
  assert.ok(!ignorer.ignores('keep.tmp'));
  assert.ok(!ignorer.ignores('a.txt'));
});
