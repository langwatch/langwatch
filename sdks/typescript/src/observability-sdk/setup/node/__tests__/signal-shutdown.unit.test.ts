import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Sending a real SIGTERM/SIGINT to an in-process (mocked) SDK would kill the
// vitest worker itself, so this drives real child processes built from the
// actual setup module — the only way to observe that the SDK never owns
// process termination, while still flushing when it safely can.

const FIXTURES_DIR = join(__dirname, "fixtures");
const PACKAGE_ROOT = resolve(__dirname, "../../../../..");

let tmpDir: string;
const bundlePath = (name: string) => join(tmpDir, `${name}.cjs`);

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lw-signal-shutdown-"));
  await build({
    entryPoints: [
      join(FIXTURES_DIR, "no-signal-interception-host.ts"),
      join(FIXTURES_DIR, "before-exit-flush-host.ts"),
      join(FIXTURES_DIR, "host-owned-shutdown-host.ts"),
    ],
    outdir: tmpDir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    packages: "external",
    tsconfig: join(PACKAGE_ROOT, "tsconfig.json"),
    logLevel: "silent",
  });
}, 30_000);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

interface HostResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
}

function runHost(
  fixture: string,
  { onReady }: { onReady: (child: ChildProcess) => void },
): Promise<HostResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bundlePath(fixture)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_PATH: join(PACKAGE_ROOT, "node_modules") },
    });

    let stdout = "";
    let stderr = "";
    let readySeen = false;

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`host process did not exit in time; stdout=${stdout} stderr=${stderr}`));
    }, 8_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!readySeen && stdout.includes("READY\n")) {
        readySeen = true;
        onReady(child);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code, exitSignal) => {
      clearTimeout(timeout);
      resolvePromise({ code, signal: exitSignal, stdout });
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe("SIGINT/SIGTERM are never intercepted by the SDK", () => {
  it("still terminates via the signal's own default disposition, unhung and uncoded", async () => {
    const result = await runHost("no-signal-interception-host", {
      onReady: (child) => child.kill("SIGTERM"),
    });

    expect(result.signal).toBe("SIGTERM");
    expect(result.code).toBeNull();
  });

  it("does the same for SIGINT", async () => {
    const result = await runHost("no-signal-interception-host", {
      onReady: (child) => child.kill("SIGINT"),
    });

    expect(result.signal).toBe("SIGINT");
    expect(result.code).toBeNull();
  });
});

describe("beforeExit flush on a natural process end", () => {
  it("flushes once the event loop drains, without any signal", async () => {
    // No signal is sent — the loop just drains on its own.
    const result = await runHost("before-exit-flush-host", { onReady: () => undefined });

    expect(result.stdout).toContain("FLUSHED\n");
    expect(result.signal).toBeNull();
  });
});

describe("host-owned shutdown (the instrumentation.node.ts + start.ts pattern)", () => {
  it("flushes exactly once and exits with the host's own code, never double-fired by the SDK", async () => {
    const result = await runHost("host-owned-shutdown-host", {
      onReady: (child) => child.kill("SIGTERM"),
    });

    const handlerRuns = result.stdout.match(/HANDLER_RUN:\d+/g) ?? [];
    expect(handlerRuns).toEqual(["HANDLER_RUN:1"]);
    expect(result.stdout).toContain("FLUSHED\n");
    expect(result.code).toBe(91);
    expect(result.signal).toBeNull();
  });
});
