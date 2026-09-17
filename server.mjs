/**
 * 取名工坊 · 零依赖静态服务器
 * 用法：node server.mjs [端口]     默认 http://127.0.0.1:8777
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
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) {           // 防止目录穿越
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    // 目录请求（如 /name-web/）按 GitHub Pages 的规则回落到该目录下的 index.html
    if (!err && st.isDirectory()) {
      serve(path.join(file, 'index.html'), res, req);
      return;
    }
    serve(file, res, req);
  });
});

function serve(file, res, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': 'no-cache' };
    const accept = req.headers['accept-encoding'] || '';
    const compressible = /json|javascript|css|html|svg|text/.test(type) && st.size > 1024;
    if (compressible && /\bgzip\b/.test(accept)) {
      headers['content-encoding'] = 'gzip';
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
      return;
    }
    headers['content-length'] = st.size;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`取名工坊已启动：http://${HOST}:${PORT}/`);
});
