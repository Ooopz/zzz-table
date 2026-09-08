// src/sync/workshop-api.js —— 「绝区零工坊」（api.zzzmap.com）API 客户端：签名（MD5(key+参数排序)，无需 token）+ 带重试请求。
// 只管 zzzmap（与 mihoyo-api.js 分工）；workshop.js 与 workshop-stats.js 共用。
// 代理：不再自带隧道，改由 Node 24+ 的 --use-env-proxy（进程启动时读 HTTPS_PROXY 等环境变量）统一处理，
// 启用了即进程内所有 fetch 走代理。入口脚本（server.js / workshop-cli.mjs）的 npm script 已带该 flag。
import crypto from 'node:crypto';
import { sleep } from './mihoyo-api.js';

// ---------- 签名协议（逆向自工坊 wxapkg） ----------
const KEY = 'VW^)(^*^$$#*%(#)!@VIAI%';
const BASE = 'https://api.zzzmap.com';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

function makeSign(data) {
  const params = { key: KEY, ...data };
  const str = Object.entries(params)
    .map(([k, v]) => `${k}=${v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('&')
    .split('&')
    .sort()
    .join('&');
  return md5(str);
}
function filterParams(data) {
  const o = {};
  for (const [k, v] of Object.entries(data || {})) if (v != null) o[k] = v;
  return o;
}

// ---------- 带重试的请求 ----------
/** 非 2xx / 非 JSON（风控返回 HTML 页）/ 网络错误 → 指数退避重试（2s→6s→18s→54s），仍失败才抛错（调用方记 fail 续爬）。
 *  默认 30s 超时：原生 fetch 无超时，TCP 半开会让整个同步挂起占锁；调用方已给 signal 时尊重之。 */
const RETRY_MAX = 4; // 重试次数（不含首次）
const RETRY_BASE = 2000; // 初始退避 2s，指数 ×3
const REQUEST_TIMEOUT_MS = 30_000;
async function fetchJson(url, opts, attempt = 0) {
  let res;
  try {
    res = await fetch(url, { ...opts, ...(opts.signal ? {} : { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }) });
  } catch (e) {
    if (attempt < RETRY_MAX) {
      await sleep(RETRY_BASE * 3 ** attempt);
      return fetchJson(url, opts, attempt + 1);
    }
    throw new Error(`网络错误: ${e.message}`, { cause: e });
  }
  const text = await res.text(); // 先取全文：HTML 风控页与 JSON 分开处理
  if (!res.ok) {
    if (attempt < RETRY_MAX) {
      await sleep(RETRY_BASE * 3 ** attempt);
      return fetchJson(url, opts, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 60)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (attempt < RETRY_MAX) {
      await sleep(RETRY_BASE * 3 ** attempt);
      return fetchJson(url, opts, attempt + 1);
    }
    throw new Error(`非 JSON 响应（疑似风控）: ${text.slice(0, 60)}`);
  }
}
export async function apiGet(path, data) {
  const d = filterParams(data);
  const time = Date.now();
  const qs = new URLSearchParams(d).toString();
  return fetchJson(`${BASE}${path}${qs ? '?' + qs : ''}`, {
    headers: {
      'content-type': 'application/json',
      version: '100',
      platform: 'weixin',
      sign: makeSign(d),
      time: String(time),
    },
  });
}
export async function apiPost(path, data) {
  const d = filterParams(data);
  const time = Date.now();
  return fetchJson(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      version: '100',
      platform: 'weixin',
      sign: makeSign(d),
      time: String(time),
    },
    body: JSON.stringify(d),
  });
}
