// src/sync/mihoyo-api.js —— 米游社接口统一请求封装（Node 专属，仅供 sync 脚本与 server.js 复用）
// 吸收 library.js/characters.js/plans.js 三套请求实现，差异经 retry 选项保留。
import { serializeCookies } from '../lib/util.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 客户端模拟常量（单一权威）：App 升级后接口可能校验/风控（retcode 10041/10035），需按新客户端抓包同步更新这里。
 *  characters.js / plans.js 从这里取；⚠️ collect.js（采集书签）为自包含脚本不可 import，改这里时必须同步改 src/web/collect.js。 */
export const MHY_UA =
  'Mozilla/5.0 (Linux; Android 9; 23113RKC6C Build/PQ3A.190605.06200901; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Mobile Safari/537.36 miHoYoBBS/2.75.2';
export const MHY_DEVICE = {
  app_version: '2.75.2',
  device_id: '06770e63-c0e8-38da-89bd-1a1e504b6bfd',
  device_name: 'Redmi%2023113RKC6C',
  device_fp: '38d7fe73b1032',
  sys_version: '9',
};

/**
 * 请求 JSON 接口：cookie 序列化 + HTTP 状态 + retcode 业务码校验 + 可配置重试（retry null = 不重试）。
 * 默认 30s 超时：原生 fetch 无超时，TCP 半开会让同步永久挂起（busy 锁被占满 6h 才能强夺）；AbortError
 * 走网络错误分支并入重试。传 timeout: 0 关闭。
 */
const REQUEST_TIMEOUT_MS = 30_000;
export async function requestJson(url, { headers = {}, cookies = null, retry = null, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const cookie = cookies ? serializeCookies(cookies) : null;
  let attempt = 0;
  for (;;) {
    let res, j;
    try {
      const signal = timeout ? AbortSignal.timeout(timeout) : undefined;
      res = await fetch(url, { headers: cookie ? { ...headers, cookie } : headers, ...(signal ? { signal } : {}) });
      j = await res.json().catch(() => null);
    } catch (e) {
      // fetch 网络层抛错（onError 重试打开时才等待重试，否则原样抛出）
      if (retry?.onError && attempt < retry.delays.length) {
        await sleep(retry.delays[attempt++]);
        continue;
      }
      throw e;
    }
    // HTTP 状态 / 业务码级重试（如 plans 的 429 / retcode 10041 风控）
    if (retry?.on && retry.on(res, j) && attempt < retry.delays.length) {
      console.warn(
        `  ⚠ ${res.status === 429 ? `HTTP ${res.status}` : `retcode ${j?.retcode}`}：请求受限，等待 ${(retry.delays[attempt] / 1000).toFixed(0)}s 后重试（${attempt + 1}/${retry.delays.length}）`
      );
      await sleep(retry.delays[attempt++]);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // 仅当响应带 retcode 字段且非 0 才抛错（wiki 等无 retcode 字段的接口不受影响）
    if (j && 'retcode' in j && j.retcode !== 0)
      throw new Error(`retcode ${j.retcode}${j.message || j.msg ? ': ' + (j.message || j.msg) : ''}`);
    return j;
  }
}

/** 重试策略预设（复刻三脚本现状） */
export const retry = {
  /** 简单重试（library 原 fetchJSON）：网络/HTTP 错误，间隔 800ms×(i+1) */
  simple(times = 3) {
    return {
      delays: Array.from({ length: times - 1 }, (_, i) => 800 * (i + 1)),
      on: (res) => !res.ok,
      onError: true,
    };
  },
  /** 指数退避（plans 原 request）：429 / retcode 10041 风控，等待 5s → 15s → 45s */
  backoff() {
    return {
      delays: [5000, 15000, 45000],
      on: (res, j) => res.status === 429 || j?.retcode === 10041,
      onError: false,
    };
  },
};

/** 取账号绑定 uid（characters 与 plans 共用同一 binding 接口） */
export async function fetchUid(cookies, headers, { retry: r = null } = {}) {
  const j = await requestJson('https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?game_biz=nap_cn', {
    headers,
    cookies,
    retry: r,
  });
  const list = j.data?.list || [];
  if (!list.length) throw new Error('账号下没有绝区零角色，请确认 cookie 属于正确的米游社账号');
  return list[0].game_uid;
}
