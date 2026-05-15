/**
 * End-to-end test for BUG B3 — eval-v3's TargetCell missing trace_id.
 *
 *   [test]
 *     │ POST /go/studio/execute (SSE) with an execute_component event
 *     │ carrying a known trace_id
 *     ▼
 *   [real nlpgo subprocess (prebuilt binary)]
 *     │ Server-Sent Events stream
 *     ▼
 *   [test parses `component_state_change` frames]
 *
 * Asserts (against the SSE frames nlpgo actually emits):
 *   Every `component_state_change` event carries
 *   `payload.execution_state.trace_id` === the inbound trace_id.
 *
 * Why this is the right proof: eval-v3's TargetCell reads the per-row
 * trace id EXCLUSIVELY from `execution_state.trace_id`
 * (resultMapper.ts:306). The eval-v3 orchestrator generates the
 * trace_id and sends it INTO nlpgo as the request trace_id; nlpgo must
 * echo it back inside execution_state or the cell's `traceId` resolves
 * to undefined and the "View trace" link never renders — exactly the
 * 2026-05-15 dogfood symptom. Python's start/end/error component events
 * all set ExecutionState.trace_id (langwatch_nlp/studio/types/events.py
 * :216,250,269); the Go port had dropped that field, carrying the id
 * only on the (for this event type, unused) outer envelope.
 *
 * Unlike the traceparent-roundtrip test this needs no ClickHouse / Redis
 * / OTLP pipeline — the regression is purely in what nlpgo streams back,
 * so we assert directly on the wire frames. Gate is therefore just `go`.
 *
 * Cost amortization: a prebuilt binary (not `go run`) is cached under
 * langwatch/.vitest-tmp/ and exec'd directly — same pattern and rationale
 * as traceparent-roundtrip.integration.test.ts. Skipped when `go` is not
 * on PATH.
 */
import {
  execFileSync,
  execSync,
  spawn,
  type ChildProcess,
} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Unique port alongside the other nlpgo subprocess integration tests
// (55610 / 55611 / 55612 / 55620 — see CLAUDE.md). 55613 is this test's.
const NLPGO_PORT = 55613;
const KNOWN_TRACE_ID = "b3eval0123456789b3eval0123456789";

// /langwatch/src/server/nlpgo/__tests__  → up 5 = repo root
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

function hasGo(): boolean {
  try {
    execSync("go version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const shouldRun = hasGo();

const NLPGO_TEST_BIN_DIR = path.join(REPO_ROOT, "langwatch", ".vitest-tmp");
const NLPGO_TEST_BIN = path.join(
  NLPGO_TEST_BIN_DIR,
  process.platform === "win32" ? "nlpgo-test.exe" : "nlpgo-test",
);

/**
 * Builds the nlpgo binary once and caches it on disk, rebuilding only
 * when a .go source under services/nlpgo / cmd/service / pkg is newer
 * than the cached binary. Identical staleness logic to
 * traceparent-roundtrip.integration.test.ts so the two tests share the
 * one cached artifact within a CI job.
 */
function ensureNlpgoBinary(timeoutMs = 600_000): string {
  fs.mkdirSync(NLPGO_TEST_BIN_DIR, { recursive: true });

  let cachedMtime = 0;
  try {
    cachedMtime = fs.statSync(NLPGO_TEST_BIN).mtimeMs;
  } catch {
    cachedMtime = 0;
  }
  const watchDirs = [
    path.join(REPO_ROOT, "services", "nlpgo"),
    path.join(REPO_ROOT, "cmd", "service"),
    path.join(REPO_ROOT, "pkg"),
  ].filter((p) => fs.existsSync(p));

  function newestGoMtime(dir: string): number {
    let newest = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name.startsWith(".")) continue;
          stack.push(full);
        } else if (
          e.name.endsWith(".go") ||
          e.name === "go.mod" ||
          e.name === "go.sum"
        ) {
          try {
            const m = fs.statSync(full).mtimeMs;
            if (m > newest) newest = m;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return newest;
  }

  const newestSrcMtime = watchDirs.reduce(
    (acc, d) => Math.max(acc, newestGoMtime(d)),
    0,
  );

  if (cachedMtime > 0 && newestSrcMtime <= cachedMtime) {
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
  return NLPGO_TEST_BIN;
}

describe.skipIf(!shouldRun)(
  "nlpgo eval-v3 — component_state_change carries trace_id in execution_state (B3)",
  () => {
    let nlpgoProcess: ChildProcess | null = null;

    async function waitForNlpgoHealth(timeoutMs = 30_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const r = await fetch(`http://127.0.0.1:${NLPGO_PORT}/healthz`);
          if (r.status === 200 || r.status === 503) return;
        } catch {
          // not listening yet
        }
        await sleep(500);
      }
      throw new Error(
        `nlpgo did not become healthy within ${timeoutMs}ms — ` +
          `re-run with NLPGO_TEST_LOG=1 to stream stderr.`,
      );
    }

    beforeAll(async () => {
      const binary = ensureNlpgoBinary();
      nlpgoProcess = spawn(binary, ["nlpgo"], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          NLPGO_CHILD_BYPASS: "true",
          SERVER_ADDR: `:${NLPGO_PORT}`,
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
      nlpgoProcess.stdout?.on("data", (c: Buffer) => drain("out", c));
      nlpgoProcess.stderr?.on("data", (c: Buffer) => drain("err", c));
      nlpgoProcess.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          // eslint-disable-next-line no-console
          console.error(
            `nlpgo exited unexpectedly: code=${code} signal=${signal}`,
          );
        }
      });
      await waitForNlpgoHealth(30_000);
    }, 700_000); // cold go build budget + boot + health

    afterAll(async () => {
      if (nlpgoProcess?.pid) {
        const pgid = -nlpgoProcess.pid;
        try {
          process.kill(pgid, "SIGTERM");
        } catch {
          /* group already gone */
        }
        const exited = await Promise.race([
          new Promise<boolean>((resolve) =>
            nlpgoProcess!.once("exit", () => resolve(true)),
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
      }
    });

    // execute_component is exactly what the eval-v3 orchestrator sends
    // per dataset cell (orchestrator.ts:290/386). Entry → End is a
    // dependency-free path (no LLM, no evaluator HTTP) that still emits
    // per-node component_state_change events — the minimal faithful
    // repro of the round-trip the TargetCell depends on.
    function makeExecuteComponentBody(traceId: string) {
      return {
        type: "execute_component",
        payload: {
          trace_id: traceId,
          node_id: "end",
          workflow: {
            workflow_id: "wf_b3",
            api_key: "test-key-b3-eval-trace",
            spec_version: "1.3",
            name: "B3 eval trace",
            icon: "x",
            description: "x",
            version: "x",
            template_adapter: "default",
            nodes: [
              {
                id: "entry",
                type: "entry",
                data: {
                  outputs: [{ identifier: "input", type: "str" }],
                },
              },
              { id: "end", type: "end", data: {} },
            ],
            edges: [
              {
                id: "e1",
                source: "entry",
                sourceHandle: "outputs.input",
                target: "end",
                targetHandle: "inputs.output",
                type: "default",
              },
            ],
            state: {},
          },
          inputs: { input: "hello" },
          manual_execution_mode: false,
          do_not_trace: false,
        },
      };
    }

    it(
      "every component_state_change frame echoes the inbound trace_id inside execution_state",
      async () => {
        const body = makeExecuteComponentBody(KNOWN_TRACE_ID);
        const resp = await fetch(
          `http://127.0.0.1:${NLPGO_PORT}/go/studio/execute`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              "X-LangWatch-Origin": "evaluation",
            },
            body: JSON.stringify(body),
          },
        );
        expect(
          resp.ok,
          `nlpgo /go/studio/execute responded ${resp.status}`,
        ).toBe(true);
        expect(resp.body, "SSE response must have a body stream").toBeTruthy();

        // Parse the SSE stream: nlpgo writes `data: {json}\n\n` frames
        // (handlers.go writeSSE). Collect every component_state_change
        // until the terminal `done` (or `error`) frame.
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const componentEvents: Array<Record<string, any>> = [];
        let sawDone = false;

        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && !sawDone) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Frames are separated by a blank line.
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!line) continue;
            let parsed: Record<string, any>;
            try {
              parsed = JSON.parse(line.slice("data: ".length));
            } catch {
              continue;
            }
            if (parsed.type === "component_state_change") {
              componentEvents.push(parsed);
            } else if (parsed.type === "done" || parsed.type === "error") {
              sawDone = true;
            }
          }
        }
        try {
          await reader.cancel();
        } catch {
          /* stream already closed */
        }

        // The execute_component path must emit per-node state events —
        // without them the eval-v3 result cell has nothing to populate.
        expect(
          componentEvents.length,
          "nlpgo emitted no component_state_change frames for the " +
            "execute_component request",
        ).toBeGreaterThan(0);

        // CORE ASSERTION — the field eval-v3's TargetCell reads
        // (execution_state.trace_id, resultMapper.ts:306) is present
        // and equals the trace_id the orchestrator sent in. Pre-fix it
        // was absent (carried only on the unused outer envelope), so
        // the cell's trace link never rendered.
        for (const ev of componentEvents) {
          const es = ev?.payload?.execution_state;
          expect(
            es,
            `component_state_change missing execution_state: ${JSON.stringify(ev)}`,
          ).toBeTruthy();
          expect(
            es.trace_id,
            `component_state_change.execution_state.trace_id missing/blank ` +
              `(status=${es?.status}) — eval-v3 TargetCell would render no ` +
              `"View trace" link. Frame: ${JSON.stringify(ev)}`,
          ).toBe(KNOWN_TRACE_ID);
        }
      },
      60_000,
    );
  },
);
