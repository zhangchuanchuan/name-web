/**
 * 取名工坊 · 零依赖静态服务器
 * 用法：node server.mjs [端口]     默认 http://127.0.0.1:8777
 *
 * 只做静态文件服务：正确 MIME + gzip + 目录索引回落 + 防目录穿越。
 * 对畸形请求（非法百分号编码等）返回 4xx，不会因为客户端乱请求而崩溃。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 8777);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function send(res, code, text) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
}

function serveFile(file, req, res) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, '404 Not Found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': 'no-cache' };
    const compressible = /json|javascript|css|html|svg|xml|text/.test(type) && st.size > 1024;
    const stream = fs.createReadStream(file);
    // 任何一端出错都只结束这次请求，不能让整个进程挂掉
    stream.on('error', () => { if (!res.headersSent) send(res, 500, '500 Read Error'); else res.destroy(); });
    res.on('close', () => stream.destroy());
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip' });
      stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': st.size });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  try {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
    } catch {
      return send(res, 400, '400 Bad Request');   // 非法百分号编码（如 %%）
    }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {   // 防目录穿越
      return send(res, 403, 'Forbidden');
    }
    fs.stat(file, (err, st) => {
      // 目录请求按 GitHub Pages 的规则回落到该目录下的 index.html
      if (!err && st.isDirectory()) return serveFile(path.join(file, 'index.html'), req, res);
      serveFile(file, req, res);
    });
  } catch {
    send(res, 500, '500 Internal Error');
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
process.on('uncaughtException', (e) => {
  console.error('[server] 未捕获异常（已忽略，服务继续）：', e.message);
});

server.listen(PORT, HOST, () => {
  console.log(`静态服务器已启动：http://${HOST}:${PORT}/`);
});
