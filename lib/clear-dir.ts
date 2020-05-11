import fs from 'fs';
import path from 'path';
// import { color } from 'console-log-colors';
import { utils } from './utils';
import { getConfig } from './config';

interface PlainObject {
  [key: string]: any;
}

const config = getConfig();
const log = utils.getLog(config);

let dataCache = {
  /** 全局文件 md5 缓存 */
  md5AllCache: {} as PlainObject,
  /** 总共处理了多个少文件 */
  fileTotalCount: 0,
  /** 总共删除了多少文件 */
  fileDelCount: 0,
  /** 根据 config.fileMinSize 规则命中删除的文件数 */
  minSizeCount: 0,
};

/** 根据配置信息决定是否删除文件 */
function handlerDelFile(filePath: string) {
  log.debug('尝试删除文件：', filePath);

  if (Array.isArray(config.exclude) && config.exclude.length) {
    for (let reg of config.exclude) {
      if (reg.test(filePath)) {
        log.debug('config.exclude 规则命中，忽略删除文件', filePath);
        return false;
      }
    }
  }

  if (Array.isArray(config.include) && config.include.length) {
    for (let reg of config.include) {
      if (reg.test(filePath)) {
        log.debug('config.include 规则命中，删除文件', filePath);
        fs.unlinkSync(filePath);
        dataCache.fileDelCount++;
        return true;
      }
    }
  } else {
    log.debug('删除文件', filePath);
    fs.unlinkSync(filePath);
    dataCache.fileDelCount++;
    return true;
  }

  return false;
}

function clearDir(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;

  const fileList = fs.readdirSync(dir);
  const md5Cache = {};
  const subDirList = [];
  let delFileCount = 0;

  log.log('\n');
  log.info('开始清理目录：', dir);
  log.info('当前目录中总文件/子目录数：', fileList.length);

  for (let filename of fileList) {
    if (!filename || ['.', '..'].includes(filename)) continue;

    const filePath = path.resolve(dir, filename);
    const fileStat = fs.statSync(filePath);

    if (config.isClearSubDir && fileStat.isDirectory()) {
      subDirList.push(filePath);
      continue;
    }

    if (fileStat.isFile()) {
      const md5 = utils.getMd5(filePath);

      dataCache.fileTotalCount++;

      if (md5Cache[md5]) {
        if(handlerDelFile(filePath)) delFileCount++;
      } else {
        md5Cache[md5] = filePath;

        if (config.compareAllDir) {
          if (!dataCache.md5AllCache[md5]) {
            dataCache.md5AllCache[md5] = filePath;
          } else {
            if(handlerDelFile(filePath)) {
              delFileCount++;
            }
            continue;
          }
        }

        // 小文件清理
        if (config.fileMinSize > 0) {
          if (fileStat.size / 1024 < config.fileMinSize) {
            if(handlerDelFile(filePath)) {
              dataCache.minSizeCount++;
              delFileCount++;
              if (dataCache[filePath]) delete dataCache[filePath];
            }
            continue;
          }
        }
      }
    }
  }

  log.info('清理完毕！剩余文件/子目录：', fileList.length - delFileCount);
  if (dataCache.minSizeCount) log.info('清理的小文件件数量为：', dataCache.minSizeCount);

  // 清理子目录
  if (subDirList.length) {
    for (let subDir of subDirList) {
      clearDir(subDir);
    }
  }

  if (config.isDelEmptyDir) {
    if (!fs.readdirSync(dir).length) {
      log.info('移除空目录：', dir);
      fs.rmdirSync(dir);
    }
  }
}

export function cleaner(cfg) {
  // 初始化配置参数
  cfg = Object.assign(config, cfg);

  if (cfg.configPath) {
    cfg.configPath = path.resolve(cfg.configPath);
    if (fs.existsSync(cfg.configPath)) {
      log.debug('读取配置文件', cfg.configPath);
      Object.assign(config, require(cfg.configPath));
    }
  }
  // 规整一下
  Object.assign(config, getConfig(cfg));
  log.debug('最终的配置信息：', config);

  // 初始化缓存数据
  Object.keys(dataCache).forEach(key => {
    if (typeof dataCache[key] === 'number') {
      dataCache[key] = 0;
    } else dataCache[key] = {};
  });

  clearDir(config.baseDir);

  return dataCache;
}
