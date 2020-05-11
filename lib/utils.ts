import fs from 'fs';
import crypto from 'crypto';
import { color } from 'console-log-colors';

export const utils = {
  /** 获取指定路径文件的 md5 值。指定的文件必须存在 */
  getMd5: (filename: string) => {
    const buffer = fs.readFileSync(filename);
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');

    // log(`文件的MD5是：${md5}`, filename);
    return md5;
  },
  getLog: (config) => {
    return {
      log: (...args) => {
        if (config.isSilent) return;
        console.log(...args);
      },
      info: (...args) => {
        if (config.isSilent) return;
        args.unshift(color.bgBlue('[INFO]'));
        console.log(...args);
      },
      sucess: (...args) => {
        if (config.isSilent) return;
        args.unshift(color.bgGreen('[SUCESS]'));
        console.log(...args);
      },
      debug: (...args) => {
        if (!config.debug) return;
        args.unshift(color.bgYellow('[DEBUG]'));
        console.log(...args);
      },
    }
  }
};

// module.exports = utils;
