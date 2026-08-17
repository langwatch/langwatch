/**
 * Shared subprocess harness for nlpgo end-to-end integration tests.
 *
 * Boots the REAL nlpgo Go binary as a child process so a test can drive
 * it over HTTP/SSE exactly as Studio does, then asserts on what nlpgo
 * actually streams back. This is the lightweight sibling of the heavier
 * ClickHouse-backed traceparent-roundtrip.integration.test.ts — same
 * prebuilt-binary boot strategy, but no event-sourcing pipeline: use it
 * when the behaviour under test is observable on the SSE wire alone.
 *
 * Not a test file (underscore prefix + no `.test.ts` suffix) so vitest
 * does not pick it up as a suite.
 *
 * Cost amortization: `go run ./cmd/service` recompiles on every call,
 * which on CI's cold module cache blows any reasonable health-poll
 * budget. We `go build` ONCE per test process into a cached path under
 * the repo's platform/app/.vitest-tmp/ and exec it directly — the compiled
 * binary boots in ~1s. The cached artifact is shared across every test
 * that calls ensureNlpgoBinary() within the same CI job.
 */
import {
  type ChildProcess,
  execFileSync,
  execSync,
  spawn,
} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  cachedBinaryIsUsable,
  digestGoSources,
  writeStamp,
} from "./_nlpgoBinaryStamp";

// _nlpgoSubprocess.ts lives in platform/app/src/server/nlpgo/__tests__ →
// up 6 = repo root.
export const REPO_ROOT = path.resolve(__dirname, "../../../../../..");

const NLPGO_TEST_BIN_DIR = path.join(
  REPO_ROOT,
  "platform",
  "app",
  ".vitest-tmp",
);
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
 * Builds the nlpgo binary once and caches it on disk, rebuilding only when a
 * build input under services/nlpgo / cmd/service / pkg differs in CONTENT from
 * the sources the cached binary was compiled from. Returns the absolute binary
 * path.
 *
 * Content rather than modification time, because mtimes make the cache
 * unhittable on CI: git records none, so actions/checkout stamps every source
 * with the current run's time while the binary actions/cache restored carries
 * the time it was built in an earlier run. An mtime comparison therefore found
 * every source newer than the binary and rebuilt on every run — ~90s a shard
 * for a cache that was restoring correctly the whole time. See
 * specs/ci/nlpgo-test-binary-reuse.feature.
 */
export function ensureNlpgoBinary(timeoutMs = 600_000): string {
  fs.mkdirSync(NLPGO_TEST_BIN_DIR, { recursive: true });

  const watchDirs = [
    path.join(REPO_ROOT, "services", "nlpgo"),
    path.join(REPO_ROOT, "cmd", "service"),
    path.join(REPO_ROOT, "pkg"),
  ];
  const digest = digestGoSources({ watchDirs, root: REPO_ROOT });

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

async function waitForNlpgoHealth(
  port: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
 * Builds (cached) + spawns nlpgo on the given port and resolves once
 * /healthz answers. The caller MUST `await sub.stop()` in afterAll.
 *
 * Picks a port from the nlpgo subprocess test range (55610/55611/55612
 * /55613/55620 — see CLAUDE.md); pass a unique one per test file so
 * parallel suites don't collide.
 *
 * `env` is merged over the defaults (NLPGO_CHILD_BYPASS=true so no Python
 * uvicorn child is spawned, SERVER_ADDR bound to the port). Pass e.g.
 * LANGWATCH_ENDPOINT when the workflow under test calls back out.
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
      // eslint-disable-next-line no-console
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
        new Promise<boolean>((resolve) =>
          child.once("exit", () => resolve(true)),
        ),
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
  payload?: Record<string, any>;
  [k: string]: any;
}

/**
 * Consumes an SSE response body from nlpgo's /go/studio/execute and
 * returns every parsed `data:` frame. nlpgo writes `data: {json}\n\n`
 * frames (handlers.go writeSSE); frames are blank-line separated.
 *
 * Stops when a frame whose `type` is in `terminalTypes` arrives
 * (default: "done" / "error"), the stream ends, or `timeoutMs` elapses.
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
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline && !sawTerminal) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let parsed: SSEFrame;
        try {
          parsed = JSON.parse(line.slice("data: ".length));
        } catch {
          continue;
        }
        frames.push(parsed);
        if (terminal.has(parsed.type)) sawTerminal = true;
      }
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
