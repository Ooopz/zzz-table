// src/lib/nodeUtil.js —— Node 专属工具（依赖 node:child_process / node:fs 等，不要被浏览器 import）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';
import { warnIfInvalid } from './schema.js';

/** 跨平台打开浏览器（Windows: start / macOS: open / Linux: xdg-open） */
export function openBrowser(url) {
  try {
    if (process.platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch {
    console.log(`  未能自动打开浏览器，请手动访问: ${url}`);
  }
}

// ---------- 同步脚本共用样板（三个 src/sync/* 脚本原各有一份，统一收敛于此） ----------

/** 项目根目录（本文件位于 src/lib/ 下，向上两级） */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** data/ 数据目录（同步脚本写 data/*.json 用） */
export const DATA_DIR = path.join(ROOT, 'data');

// ---------- cookie 缓存（明文米游社登录态，属「关键写入」） ----------
// 收敛在 node.js 而不在 characters.js：server.js 的 /api/cookie-status 等轮询接口只想知道
// 「是否已缓存/何时存的」，不必经 characters 模块整树懒加载（顶层会建 ~5.5MB library 名称索引）。
export const COOKIE_FILE = path.join(DATA_DIR, '.cookie.json');
/** 缓存 cookie（原子写 tmp+rename）：写一半被杀会截断登录态，readCookieCache 只能返回 null 重贴 */
export function cacheCookies(cookies) {
  fs.mkdirSync(DATA_DIR, { recursive: true }); // data/ 目录存在性兜底
  const tmp = `${COOKIE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cookies, null, 2), 'utf-8');
  fs.renameSync(tmp, COOKIE_FILE);
}
/** 读 cookie 缓存；不存在/损坏返回 null */
export function readCookieCache() {
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/** ESM 入口判断：仅当直接运行该脚本文件时执行 run()（异常统一捕获并 exit(1)）。 */
export function isMain(meta, run) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta.url))
    run().catch((e) => {
      console.error('运行出错:', e.message);
      process.exit(1);
    });
}

/** 并发池：最多 limit 个 worker 并行执行 fn(item, index)；结果按下标对齐返回，单任务失败返回 null（错误已打印）。
 *  onProgress 可选，每个任务结束后回调 (done, total)。library/characters/plans/workshop 四个同步脚本共用。 */
export async function pool(items, limit, fn, onProgress) {
  const ret = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
      while (next < items.length) {
        const i = next++;
        ret[i] = await fn(items[i], i).catch((e) => {
          console.error(`  ✗ 任务 ${i} 失败: ${e.message}`);
          return null;
        });
        done++;
        onProgress?.(done, items.length);
      }
    })
  );
  return ret;
}

// ---------- 跨进程同步互斥 ----------
/** data/.sync.lock 独占锁（O_EXCL）：server.js 的 busy 是进程内内存锁，与 CLI（workshop-cli）互不感知——
 *  两进程并发爬工坊会对 data/*.json 用同名 .tmp 互相截断、last-wins 得到损坏文件。网页同步与 CLI 都在写盘前拿它。
 *  成功返回 release()（幂等）；持锁失败返回 null。残留锁自愈：持有进程已死（ESRCH）或超 6h 判 stale，删后重试一次。 */
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;
const LOCK_FILE = path.join(DATA_DIR, '.sync.lock');
export function tryAcquireDataLock(label = '同步') {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, label, at: Date.now() }));
      fs.closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          /* 已被清理/不存在，幂等 */
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') return null; // 其他 IO 错误：不冒险强夺
      if (attempt === 0 && isDataLockStale(LOCK_FILE)) {
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          /* 竞争删除失败则本轮让位 */
        }
        continue; // 删掉了 → 重试一次
      }
      return null;
    }
  }
  return null;
}
function isDataLockStale(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (m && Number.isFinite(m.pid)) {
      try {
        process.kill(m.pid, 0);
      } catch (err) {
        if (err && err.code === 'ESRCH') return true; // 进程已退出
        return false; // EPERM = 进程活着（Windows 常这样）
      }
    }
    return m && Number.isFinite(m.at) && Date.now() - m.at > LOCK_STALE_MS;
  } catch {
    return false; // 内容损坏 → 不自动删，宁等 6h 老化也别把活锁误删
  }
}

/** 原子写 JSON（tmp + rename）：直接覆盖时中途退出/磁盘写满会留下被截断的半个文件——下游统计的输入损坏后要重爬数小时才能恢复。
 *  工坊三件产物（workshop.json / workshop-grad.json / workshop-stats.json）与权重共用。 */
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** 校验 + 写入 data/ 下的 JSON 文件（sync 脚本收尾共用）。validate 时先 warnIfInvalid（strict 则抛错）；
 *  pretty=false 用紧凑格式——library.json 嵌套 5 层，pretty 会膨胀到 ~11MB，紧凑仅 ~3.5MB。
 *  原子写（tmp + rename，同 writeJsonAtomic 范式）：这是 library/characters/plans 的收尾写盘路径，
 *  直接覆盖中途被杀会留下被截断的半个权威文件（此前非原子，违背「全部关键写入原子」不变式）。 */
export function writeDataFile(file, data, { label = '', validate = null, strict = false, pretty = true } = {}) {
  if (validate) warnIfInvalid(label, validate(data), { strict });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const full = path.join(DATA_DIR, file);
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, full);
}

// ---------- workshop.json：分块 gzip（非固实）存储 ----------
// 按固定条目数切块、每块独立 gzip（任一块可独立解压/定位，读第 N 块无需解压前面的块）。布局：
//   第 0 行头部 {"meta":{...},"perChunk":20000,"offsets":[0,12345,...]}，offsets 为各块相对「头部行之后」的字节偏移；
//   之后 N 个首尾相接的 gzip 流。读取 = 头部一次解析 → 逐块定长 readSync → gunzip → JSON.parse（整块解析，远快于逐字符状态机）。
const WORKSHOP_PER_CHUNK = 20000;

/** 读第 0 行头部（读完即关 fd；Windows 下未关的读句柄会挡住对同一文件的 rename） */
export function readWorkshopHeader(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(64 * 1024);
  try {
    let s = '';
    while (s.indexOf('\n') < 0) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      s += buf.subarray(0, n).toString('utf8');
      if (s.length > 4 * 1024 * 1024) break; // 防御：头不应超 4MB
    }
    const line = s.slice(0, s.indexOf('\n'));
    if (!line) throw new Error('workshop 文件缺少头部行');
    return JSON.parse(line);
  } finally {
    fs.closeSync(fd);
  }
}

/** 迭代 workshop.json 的全部配装条目（流式按块解压，每块一次性 JSON.parse） */
export function* iterWorkshopFile(file) {
  const h = readWorkshopHeader(file);
  const offsets = h.offsets || [];
  if (!offsets.length) return;
  const headLen = Buffer.byteLength(JSON.stringify(h)) + 1;
  const fd = fs.openSync(file, 'r');
  const size = fs.statSync(file).size;
  try {
    for (let i = 0; i < offsets.length; i++) {
      const start = headLen + offsets[i];
      const end = i + 1 < offsets.length ? headLen + offsets[i + 1] : size;
      const len = end - start;
      if (len <= 0) continue;
      const buf = Buffer.alloc(len);
      let read = 0;
      while (read < len) {
        const n = fs.readSync(fd, buf, read, len - read, start + read);
        if (n <= 0) break;
        read += n;
      }
      const arr = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
      for (const e of arr) yield e;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** 把条目流按 perChunk 分块 gzip 写入 outFile（原子：tmp+rename；头部最后拼装）。
 *  meta 传函数时以实际条数调用 meta(count)（转换场景 entryCount 未知）；返回写入条目数。 */
export function writeWorkshopFile(outFile, entries, meta = {}, perChunk = WORKSHOP_PER_CHUNK) {
  const tmp = `${outFile}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  const offsets = [];
  let count = 0;
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    offsets.push(fs.fstatSync(fd).size); // body 相对偏移（tmp 无头部）
    fs.writeSync(fd, zlib.gzipSync(Buffer.from(JSON.stringify(buf)), { level: 6 }));
    buf = [];
  };
  try {
    for (const e of entries) {
      buf.push(e);
      count++;
      if (buf.length >= perChunk) flush();
    }
    flush();
    if (!offsets.length) offsets.push(0); // 空文件也留一个块槽位（读侧空转）
  } finally {
    fs.closeSync(fd);
  }
  const finalMeta = typeof meta === 'function' ? meta(count) : meta;
  const head = Buffer.from(JSON.stringify({ meta: finalMeta, perChunk, offsets }) + '\n');
  const bodyFd = fs.openSync(tmp, 'r');
  const outFd = fs.openSync(`${tmp}.head`, 'w');
  try {
    fs.writeSync(outFd, head);
    const buf2 = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(bodyFd, buf2, 0, buf2.length, null)) > 0) fs.writeSync(outFd, buf2, 0, n);
  } finally {
    fs.closeSync(bodyFd);
    fs.closeSync(outFd);
  }
  fs.renameSync(`${tmp}.head`, outFile);
  fs.rmSync(tmp, { force: true });
  return count;
}

/** 通用按行读（供 PART 裸流等 JSON 行文件；\n 字节不可能出现在 UTF-8 多字节字符内，切分安全） */
export function* readLines(file, chunkSize = 1 << 20) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(chunkSize);
  let carry = Buffer.alloc(0);
  try {
    while (true) {
      const n = fs.readSync(fd, buf, 0, chunkSize, null);
      if (n <= 0) break;
      const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) {
          if (i > start) yield chunk.toString('utf8', start, i);
          start = i + 1;
        }
      }
      carry = Buffer.from(chunk.subarray(start));
    }
    if (carry.length) yield carry.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
