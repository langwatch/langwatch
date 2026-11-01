// Installs the package the way a user does and starts it.
//
// Every other test runs inside the monorepo, where workspace links resolve
// packages npm has never seen and vitest supplies a `require` the shipped ES
// module lacks. Two releases broke for exactly those reasons and passed CI:
// 2.1.0 crashed on `--http` (`Dynamic require of "tty"`), and 2.2.0/3.0.0
// listed the private `@langwatch/evaluator-contract` as a dependency, so
// `npx @langwatch/mcp-server` failed with a 404.
//
// So: pack as `pnpm publish` would, `npm install` the tarball into an empty
// folder against the public registry, then start stdio mode, start HTTP mode,
// and load the library entries through both `import` and `require`.
//
// Run after `pnpm run build`: `pnpm run smoke`.

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "mcp-smoke-"));
const children = new Set();

function cleanup() {
  for (const child of children) child.kill("SIGKILL");
  rmSync(work, { recursive: true, force: true });
}

function fail(message) {
  console.error(`smoke: FAIL: ${message}`);
  cleanup();
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], ...opts }).toString();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Starts the CLI and collects its output, so a crash is reported with it. */
function start(args) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: work,
    env: { ...process.env, LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY ?? "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  child.output = "";
  child.stdout.on("data", (d) => (child.output += d));
  child.stderr.on("data", (d) => (child.output += d));
  child.on("exit", () => children.delete(child));
  return child;
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Waits for `ready` to return true, failing early if the process dies. */
async function until(child, what, ready, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ready()) return;
    if (exited(child)) fail(`${what}: the server exited.\n${child.output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  fail(`${what}: no answer after ${timeoutMs / 1000}s.\n${child.output}`);
}

// 1. Pack exactly what `pnpm publish` uploads: workspace specs become versions.
run("pnpm", ["pack", "--pack-destination", work], { cwd: pkgDir });
const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
if (!tarball) fail("pnpm pack wrote no tarball");

// 2. Install it from the public registry. A dependency npm cannot fetch, such
//    as a private workspace package, fails here as it would for a user.
writeFileSync(join(work, "package.json"), JSON.stringify({ name: "smoke", private: true }));
try {
  run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", join(work, tarball)], {
    cwd: work,
  });
} catch {
  fail("npm install of the packed tarball failed (see npm's output above)");
}
const installed = join(work, "node_modules", "@langwatch", "mcp-server");
const cli = join(installed, "dist", "index.js");

// 3. Stdio mode answers an MCP initialize.
{
  const child = start([]);
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    }) + "\n",
  );
  await until(child, "stdio initialize", () => child.output.includes('"serverInfo"'));
  child.kill();
  console.log("smoke: stdio mode answers initialize");
}

// 4. HTTP mode starts and reports healthy. `/health` takes no key.
{
  const port = await freePort();
  const child = start(["--http", "--port", String(port)]);
  await until(child, "http /health", async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      return res.ok;
    } catch {
      return false;
    }
  });
  child.kill();
  console.log("smoke: http mode is healthy");
}

// 5. The library entries load through both doors of the exports map.
for (const entry of ["create-mcp-server", "config"]) {
  const spec = `@langwatch/mcp-server/${entry}`;
  for (const how of ["import", "require"]) {
    const code =
      how === "import"
        ? `await import(${JSON.stringify(spec)})`
        : `require(${JSON.stringify(spec)})`;
    try {
      run(process.execPath, [how === "import" ? "--input-type=module" : "--input-type=commonjs", "-e", code], {
        cwd: work,
      });
    } catch {
      fail(`${how} ${spec} failed (see node's output above)`);
    }
  }
}
console.log("smoke: library entries load via import and require");

cleanup();
console.log("smoke: ok");
