const { spawn } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const node = process.execPath;

const processes = [
  {
    name: "backend",
    cwd: path.join(root, "backend"),
    args: ["server.cjs"],
    env: { BACKEND_PORT: "8787" },
  },
  {
    name: "frontend",
    cwd: path.join(root, "frontend"),
    args: ["dev-server.cjs"],
    env: { FRONTEND_PORT: "5173" },
  },
];

const children = processes.map((processConfig) => {
  const child = spawn(node, processConfig.args, {
    cwd: processConfig.cwd,
    env: { ...process.env, ...processConfig.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${processConfig.name}] ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${processConfig.name}] ${chunk}`);
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[${processConfig.name}] exited with code ${code}\n`);
    }
  });

  return child;
});

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

console.log("Frontend: http://127.0.0.1:5173");
console.log("Backend:  http://127.0.0.1:8787");
