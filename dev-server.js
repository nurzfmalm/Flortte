const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
const espHost = process.env.ESP32_HOST || "10.80.22.121";
const espPort = Number(process.env.ESP32_PORT || 8080);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${port}`}`);

    if (url.pathname.startsWith("/esp32/")) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
        "Cache-Control": "no-store",
      };

      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...corsHeaders, "Content-Length": "0" });
        res.end();
        return;
      }

      const espPath = `/${url.pathname.slice("/esp32/".length)}${url.search}`;
      const proxyReq = http.request({
        host: espHost,
        port: espPort,
        path: espPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${espHost}:${espPort}`,
          connection: "close",
        },
        timeout: 8000,
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, {
          "Content-Type": proxyRes.headers["content-type"] || "application/octet-stream",
          ...corsHeaders,
        });
        proxyRes.pipe(res);
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy(new Error("ESP32 proxy timeout"));
      });
      proxyReq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders });
        res.end(`ESP32 proxy error: ${err.message}`);
      });

      req.pipe(proxyReq);
      return;
    }

    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.resolve(root, `.${pathname}`);

    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(port, host, () => {
  console.log(`Flortte dev server: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/`);
  console.log(`ESP32 proxy target: http://${espHost}:${espPort}/`);
});
