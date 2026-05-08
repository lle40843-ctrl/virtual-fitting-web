const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.FRONTEND_PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.resolve(root, relative);

  if (!filePath.startsWith(root)) {
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
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  });
}

http.createServer(sendStatic).listen(port, host, () => {
  console.log(`Frontend running at http://${host}:${port}`);
});
