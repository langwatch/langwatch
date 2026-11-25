/**
 * The published package, installed from the public registry and started.
 *
 * specs/mcp-server/packed-install.feature
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const PKG_DIR = resolve(__dirname, "../..");
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const DEADLINE_MS = 20_000;

let work: string;
let cli: string;
const children = new Set<ChildProcess>();

/** npm config from the environment outranks a project `.npmrc`, so it goes. */
function publicNpmEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^npm_config_/i.test(key)) delete env[key];
  }
  return env;
}

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

function startCli(args: string[]): ChildProcess & { output: string } {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: work,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcess & { output: string };
  children.add(child);
  child.output = "";
  child.stdout?.on("data", (d) => (child.output += d));
  child.stderr?.on("data", (d) => (child.output += d));
  return child;
}

/** Polls `ready` until the deadline, failing early with the output if the server dies. */
async function until(child: ChildProcess & { output: string }, ready: () => Promise<boolean>) {
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    if (await ready()) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`the server exited:\n${child.output}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no answer after ${DEADLINE_MS / 1000}s:\n${child.output}`);
}

describe("the published @langwatch/mcp-server", () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "mcp-packed-install-"));
    execFileSync("pnpm", ["pack", "--pack-destination", work], { cwd: PKG_DIR, stdio: "pipe" });
    const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error("pnpm pack wrote no tarball");

    writeFileSync(join(work, "package.json"), JSON.stringify({ name: "smoke", private: true }));
    // The project `.npmrc` outranks the user's, so a private registry that has
    // the workspace packages can't make a broken install pass.
    writeFileSync(
      join(work, ".npmrc"),
      `registry=${PUBLIC_REGISTRY}\n@langwatch:registry=${PUBLIC_REGISTRY}\n`,
    );
    const install = ["install", "--no-audit", "--no-fund", "--ignore-scripts"];
    execFileSync("npm", [...install, "--registry", PUBLIC_REGISTRY, join(work, tarball)], {
      cwd: work,
      env: publicNpmEnv(),
      stdio: "pipe",
    });
    cli = join(work, "node_modules", "@langwatch", "mcp-server", "dist", "index.js");
  });

  afterEach(() => {
    for (const child of children) child.kill("SIGKILL");
    children.clear();
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  /** @scenario "Every runtime dependency installs from the public registry" */
  it("installs from the public registry", () => {
    expect(readdirSync(join(work, "node_modules", "@langwatch"))).toContain("mcp-server");
  });

  /** @scenario "The installed server answers over stdio" */
  it("answers an initialize over stdio", async () => {
    const child = startCli([]);
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    };
    child.stdin?.write(JSON.stringify(initialize) + "\n");
    await until(child, async () => child.output.includes('"serverInfo"'));
    expect(child.output).toContain('"serverInfo"');
  });

  /** @scenario "The installed server starts in HTTP mode" */
  it("reports healthy in HTTP mode", async () => {
    const port = await freePort();
    const child = startCli(["--http", "--port", String(port)]);
    let health: unknown;
    await until(child, async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.ok) health = await res.json();
        return res.ok;
      } catch {
        return false;
      }
    });
    expect(health).toEqual({ status: "ok" });
  });

  /** @scenario "The library entries load through both doors of the exports map" */
  it.each([
    ["create-mcp-server", "import"],
    ["create-mcp-server", "require"],
    ["config", "import"],
    ["config", "require"],
  ])("loads %s through %s", (entry, door) => {
    const spec = JSON.stringify(`@langwatch/mcp-server/${entry}`);
    const [type, code]: [string, string] =
      door === "import" ? ["module", `await import(${spec})`] : ["commonjs", `require(${spec})`];
    expect(() =>
      execFileSync(process.execPath, [`--input-type=${type}`, "-e", code], {
        cwd: work,
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
