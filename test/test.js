const { cleaner, getConfig } = require('../');
const path = require('path');
const fs = require('fs');


function getArgvConfig() {
  const config = getConfig();
  const dest = (process.argv[2] || './').trim();
  const baseDir = path.resolve(dest);

  if (!fs.existsSync(baseDir)) {
    console.log('指定的目录不存在：', baseDir);
    return;
  }
  config.baseDir = baseDir;
  return config;
}

const doStart = () => {
  // const baseDir = 'C:\\Users\\lzw\\Documents\\WeChat Files\\renxia000\\Attachment';
  // config.baseDir = 'J:\\Users\\Pictures';
  const config = getArgvConfig();
  if (!config) return;

  const result = cleaner(config);

  console.log(`\n清理完成！共处理了 ${result.fileTotalCount} 个文件，删除了 ${result.fileDelCount} 个文件`);
}

doStart();
