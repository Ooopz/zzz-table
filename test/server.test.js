// test/server.test.js —— server.js 路由集成测试（纯内联，无 DOM、不依赖 data/）
// 历史 bug 此前只活在注释里（ETag 内容哈希 / 413 destroy / CSRF / 路径三防 / cookie 明文不回传 /
// 畸形 cookie 解码 500 / config 空 body 清空），零自动回归锁——这里补上。
// 在临时端口起 requestHandler 独立实例；设 AUTH_TOKEN 测鉴权路径。
// ⚠️ 必须先设 process.env.AUTH_TOKEN 再动态 import：ESM 静态 import 会先求值依赖模块，读不到 env。
process.env.AUTH_TOKEN = 'test-token-abc';

import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { requestHandler, tokenOf } = await import('../server.js');
const TOKEN = 'test-token-abc';
const AUTH = { 'X-Auth-Token': TOKEN };

function listen() {
  return new Promise((resolve) => {
    const srv = http.createServer(requestHandler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const srvPromise = listen();
function closeSrv(srv) {
  return new Promise((r) => srv.close(r));
}

async function raw(method, path, { headers = {}, body } = {}) {
  const srv = await srvPromise;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: srv.address().port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('tokenOf：畸形百分号编码 cookie 不抛（回归：曾 URIError → 500）', () => {
  assert.equal(tokenOf({ headers: { cookie: 'zzz_token=%ZZ' }, url: '/' }), '%ZZ');
  assert.equal(tokenOf({ headers: { cookie: 'zzz_token=abc%' }, url: '/' }), 'abc%');
  // 无 cookie → 回落 query token
  assert.equal(tokenOf({ headers: {}, url: '/?token=x' }), 'x');
});

test('畸形 cookie + 无有效令牌 → 401 而非 500', async () => {
  const r = await raw('GET', '/index.html', { headers: { cookie: 'zzz_token=%ZZ' } });
  assert.equal(r.status, 401, '非法编码不应让顶层 catch 兜成 500');
});

test('有效令牌 → 可访问静态首页', async () => {
  const r = await raw('GET', '/', { headers: AUTH });
  assert.equal(r.status, 200);
});

test('非法百分号编码路径 → 400（serveStatic 解码失败先例）', async () => {
  const r = await raw('GET', '/%ZZ', { headers: AUTH });
  assert.equal(r.status, 400);
});

test('敏感路径被拒：/data/.cookie.json → 403（明文登录态不可下载）', async () => {
  const r = await raw('GET', '/data/.cookie.json', { headers: AUTH });
  assert.equal(r.status, 403);
});

test('路径穿越（..%2F 归一逃逸）不落到 ROOT 外', async () => {
  // posix.normalize 把 '..' 在 '/' 处夹回根，resolve 后仍落在 ROOT 内 → 文件不存在回 404，绝不外泄
  const r = await raw('GET', '/..%2F..%2Fetc%2Fpasswd', { headers: AUTH });
  assert.ok(r.status === 400 || r.status === 403 || r.status === 404, `逃逸路径应被拒，实际 ${r.status}`);
});

test('跨站 text/plain POST /api/config → 403（CSRF，简单请求无预检）', async () => {
  const r = await raw('POST', '/api/config', {
    headers: { ...AUTH, Origin: 'http://evil.example', 'Content-Type': 'text/plain' },
    body: '{"config":{}}',
  });
  assert.equal(r.status, 403);
});

test('/api/config：空 body（无 config 字段）→ 400，不写默认清空已存配置', async () => {
  const r = await raw('POST', '/api/config', {
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(r.status, 400);
});

test('/api/cookie-status 不回显 cookie 明文', async () => {
  const r = await raw('GET', '/api/cookie-status', { headers: { ...AUTH, cookie: `zzz_token=${TOKEN}` } });
  assert.equal(r.status, 200);
  assert.ok(!r.body.includes(TOKEN), '响应体不得包含 cookie 明文');
  const j = JSON.parse(r.body);
  assert.equal(typeof j.cached, 'boolean');
  assert.ok(j.savedAt === null || typeof j.savedAt === 'number', 'savedAt 为 mtime ms 或 null');
});

test('/api/data：If-None-Match 命中 → 304（ETag 是内容哈希）', async () => {
  const a = await raw('GET', '/api/data', { headers: AUTH });
  assert.equal(a.status, 200);
  const etag = a.headers.etag;
  assert.ok(etag, '应返回 ETag');
  const b = await raw('GET', '/api/data', { headers: { ...AUTH, 'If-None-Match': etag } });
  assert.equal(b.status, 304);
});

test('/login：正确 token → 302 + 种 cookie；错误 token → 302 无 Set-Cookie', async () => {
  const ok = await raw('GET', `/login?token=${TOKEN}`);
  assert.equal(ok.status, 302);
  const setCookies = ok.headers['set-cookie'];
  assert.ok(Array.isArray(setCookies) && setCookies.some((s) => s.startsWith('zzz_token=')), '正确令牌应种 cookie');
  const bad = await raw('GET', '/login?token=wrong');
  assert.equal(bad.status, 302);
  assert.ok(!bad.headers['set-cookie'], '错误令牌不应种 cookie');
});

test('关闭测试服务器', async () => {
  const srv = await srvPromise;
  await closeSrv(srv);
});
