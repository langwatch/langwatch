/**
 * nlpgo subprocess harness: real binary as child for HTTP/SSE tests. Cached
 * binary (go build once per job).
 */
import { type ChildProcess, execFileSync, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { nowInstant } from "@langwatch/time";

import { cachedBinaryIsUsable, digestGoSources, writeStamp } from "./nlpgo-binary-stamp.ts";

// nlpgo-subprocess.ts lives in packages/test-harness/src →
// up 6 = repo root.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const NLPGO_TEST_BIN_DIR = path.join(REPO_ROOT, ".vitest-tmp");
const NLPGO_TEST_BIN = path.join(
  NLPGO_TEST_BIN_DIR,
  process.platform === "win32" ? "nlpgo-test.exe" : "nlpgo-test",
);
// Lives beside the binary so actions/cache carries the two together: the
// cached path is the whole directory, and a stamp restored without its binary
// (or vice versa) is treated as a miss.
const NLPGO_TEST_BIN_STAMP = `${NLPGO_TEST_BIN}.stamp`;

/** True when `go` is on PATH — use in `describe.skipIf(!hasGo())`. */
export function hasGo(): boolean {
  try {
    execSync("go version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds and caches nlpgo binary by content (not mtime which breaks CI). See
 * specs/ci/nlpgo-test-binary-reuse.feature.
 */
export function ensureNlpgoBinary(timeoutMs = 600_000): string {
  fs.mkdirSync(NLPGO_TEST_BIN_DIR, { recursive: true });

  const watchDirs = [
    path.join(REPO_ROOT, "services", "nlpgo"),
    path.join(REPO_ROOT, "cmd", "service"),
    path.join(REPO_ROOT, "pkg"),
    // The engine imports github.com/langwatch/langwatch/sdks/go/prompts, and
    // the root go.mod `replace`s that path to ./sdks/go — so the SDK compiles
    // into this binary from the working tree, and a change there changes it.
    path.join(REPO_ROOT, "sdks", "go"),
  ];
  // Module and workspace files live at the repo root, outside every tree above.
  // A dependency bump, a `replace` retarget or a go.work edit changes what
  // compiles without touching one .go file under those trees.
  const watchFiles = [
    path.join(REPO_ROOT, "go.mod"),
    path.join(REPO_ROOT, "go.sum"),
    path.join(REPO_ROOT, "go.work"),
    path.join(REPO_ROOT, "go.work.sum"),
  ];
  const digest = digestGoSources({ watchDirs, watchFiles, root: REPO_ROOT });

  if (
    cachedBinaryIsUsable({
      binaryPath: NLPGO_TEST_BIN,
      stampPath: NLPGO_TEST_BIN_STAMP,
      currentDigest: digest,
    })
  ) {
    return NLPGO_TEST_BIN;
  }

  // execFileSync (argv array, not a shell string): REPO_ROOT can live
  // under a worktree dir whose absolute path may contain shell
  // metachars; binding through argv sidesteps that
  // (CodeQL js/shell-command-injection-from-environment).
  execFileSync("go", ["build", "-o", NLPGO_TEST_BIN, "./cmd/service"], {
    cwd: REPO_ROOT,
    stdio: process.env.NLPGO_TEST_LOG === "1" ? "inherit" : "pipe",
    timeout: timeoutMs,
  });
  // Stamp only after the build succeeds, so a failed compile leaves the old
  // stamp (or none) and the next run tries again rather than trusting a binary
  // that was never produced.
  writeStamp(NLPGO_TEST_BIN_STAMP, digest);
  return NLPGO_TEST_BIN;
}

export interface NlpgoSubprocess {
  /** Base URL, e.g. http://127.0.0.1:55613 */
  baseUrl: string;
  /** The spawned child process (already health-checked). */
  process: ChildProcess;
  /** SIGTERM the process group, escalate to SIGKILL after 3s. */
  stop: () => Promise<void>;
}

async function waitForNlpgoHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = nowInstant().epochMilliseconds + timeoutMs;
  while (nowInstant().epochMilliseconds < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.status === 200 || r.status === 503) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(
    `nlpgo did not become healthy on :${port} within ${timeoutMs}ms — ` +
      `re-run with NLPGO_TEST_LOG=1 to stream stderr.`,
  );
}

/**
 * Start nlpgo subprocess: builds (cached), spawns, health-checks. Caller must
 * stop() in afterAll.
 */
export async function startNlpgoSubprocess(opts: {
  port: number;
  env?: Record<string, string>;
  /** Build-budget for a cold `go build` (default 600s). */
  buildTimeoutMs?: number;
  /** Health-poll budget once spawned (default 30s; binary boots ~1s). */
  healthTimeoutMs?: number;
}): Promise<NlpgoSubprocess> {
  const binary = ensureNlpgoBinary(opts.buildTimeoutMs ?? 600_000);
  const child = spawn(binary, ["nlpgo"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NLPGO_CHILD_BYPASS: "true",
      SERVER_ADDR: `:${opts.port}`,
      ...opts.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const drain = (label: "out" | "err", chunk: Buffer) => {
    if (process.env.NLPGO_TEST_LOG === "1") {
      process.stderr.write(`[nlpgo:${label}] ${chunk.toString()}`);
    }
  };
  // Must drain BOTH pipes — an unconsumed stdout blocks the Go
  // subprocess once the ~64 KiB pipe buffer fills.
  child.stdout?.on("data", (c: Buffer) => drain("out", c));
  child.stderr?.on("data", (c: Buffer) => drain("err", c));
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`nlpgo exited unexpectedly: code=${code} signal=${signal}`);
    }
  });

  await waitForNlpgoHealth(opts.port, opts.healthTimeoutMs ?? 30_000);

  return {
    baseUrl: `http://127.0.0.1:${opts.port}`,
    process: child,
    stop: async () => {
      if (!child.pid) return;
      const pgid = -child.pid;
      try {
        process.kill(pgid, "SIGTERM");
      } catch {
        /* group already gone */
      }
      const exited = await Promise.race([
        new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
        sleep(3000).then(() => false),
      ]);
      if (!exited) {
        try {
          process.kill(pgid, "SIGKILL");
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

export interface SSEFrame {
  type: string;
  payload?: Record<string, unknown>;
  [k: string]: unknown;
}

/** The JSON `data:` frames among complete SSE chunks; a frame that does not parse is skipped. */
function sseDataFrames(chunks: string[]): SSEFrame[] {
  const frames: SSEFrame[] = [];
  for (const chunk of chunks) {
    const line = chunk.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try {
      frames.push(JSON.parse(line.slice("data: ".length)));
    } catch {
      continue;
    }
  }
  return frames;
}

/**
 * Consumes an SSE response body from nlpgo's /go/studio/execute, returning
 * every `data:` frame (nlpgo's writeSSE writes `data: {json}\n\n`, blank-line
 * separated). Stops on a `terminalTypes` frame, stream end, or `timeoutMs`.
 */
export async function collectSSE(
  body: ReadableStream<Uint8Array> | null,
  opts: { timeoutMs?: number; terminalTypes?: string[] } = {},
): Promise<SSEFrame[]> {
  if (!body) throw new Error("collectSSE: response has no body stream");
  const terminal = new Set(opts.terminalTypes ?? ["done", "error"]);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: SSEFrame[] = [];
  let sawTerminal = false;
  const deadline = nowInstant().epochMilliseconds + timeoutMs;

  try {
    while (nowInstant().epochMilliseconds < deadline && !sawTerminal) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      const parsed = sseDataFrames(chunks);
      frames.push(...parsed);
      if (parsed.some((frame) => terminal.has(frame.type))) sawTerminal = true;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* stream already closed */
    }
  }
  return frames;
}
