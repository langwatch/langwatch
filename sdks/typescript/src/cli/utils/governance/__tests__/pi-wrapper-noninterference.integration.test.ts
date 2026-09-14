/**
 * The pi capture path must never be something the developer notices.
 *
 * Sibling of `wrapper-shell-reapply.integration.test.ts`, and integration for
 * the same reason: the unit suites around pi assert on what the reader and the
 * builder return, and every one of them stays green with the wrapper wiring
 * absent. This drives `runWrapped("pi", …)` itself — the real `spawn`, a real
 * executable on PATH, the real session reader, the real transport over a real
 * socket — and mocks only the boundaries above the spawn (config, path choice,
 * mode resolution, plugin upkeep), because those talk to a control plane.
 *
 * Two properties, both of them absences, and an absence is exactly what passes
 * vacuously. So each is paired with a positive control in the same test:
 *
 * 1. Capture that cannot reach LangWatch leaves pi's exit code alone. Proven
 *    against a control run through a live endpoint, so "the post failed" is a
 *    fact about this harness rather than an assumption — and the count of turns
 *    reported undelivered is compared against the count the live endpoint
 *    actually received, so a run that captured nothing at all cannot pass.
 * 2. The command exits when pi exits. `runWrapped` ends in `process.exit`, so
 *    the way it can fail to exit is by never reaching that line: the final
 *    sweep awaits a post, and a post to an endpoint that accepts the connection
 *    and never answers is exactly the shape that wedges a shell. The poll
 *    timer's `unref` and its `clearInterval` are asserted beside it, because
 *    they are what would hold the loop open if that exit were ever softened.
 *
 * What this does NOT prove: the interactive-shell branch of the spawn. `SHELL`
 * is cleared so the deterministic direct-spawn branch runs; the sibling file
 * covers the `$SHELL -i -c` branch, and pi's capture block sits above the
 * branch and is identical on both.
 *
 * Feature: specs/coding-agent/pi-session-capture.feature
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Type-only aliases for the modules the factories below spread. `vi.mock` is
// hoisted above the imports, but these are erased at compile time, so naming
// them up here costs the factories nothing and keeps the annotations out of
// `typeof import(...)` form, which the SDK's lint config forbids.
import type * as claudePluginMod from "../claude-plugin";
import type * as cliLocationMod from "../cli-location";
import type * as configMod from "../config";
import type * as shellRcMod from "../shell-rc";
import type * as wrapperModeMod from "../wrapper-mode";
import type * as wrapperPathChoiceMod from "../wrapper-path-choice";

vi.mock("../../spinner", () => ({
  createSpinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("../cli-location", async (actual) => ({
  ...(await actual<typeof cliLocationMod>()),
  recordCliLocation: vi.fn(),
}));
vi.mock("../config", async (actual) => ({
  ...(await actual<typeof configMod>()),
  loadConfig: () => ({
    gateway_url: "http://gateway.invalid",
    control_plane_url: "http://control-plane.invalid",
  }),
  isLoggedIn: () => true,
  saveConfig: vi.fn(),
}));
vi.mock("../claude-plugin", async (actual) => ({
  ...(await actual<typeof claudePluginMod>()),
  updateLangwatchClaudePlugin: () => ({ action: "skipped" }),
}));
vi.mock("../shell-rc", async (actual) => ({
  ...(await actual<typeof shellRcMod>()),
  maybeOfferIngestionShellRcPersist: async () => undefined,
}));
vi.mock("../wrapper-path-choice", async (actual) => ({
  ...(await actual<typeof wrapperPathChoiceMod>()),
  resolveWrapperPath: async () => ({ mode: "ingestion", prompted: false }),
}));
vi.mock("../wrapper-mode", async (actual) => ({
  ...(await actual<typeof wrapperModeMod>()),
  resolveWrapperMode: async () => modeResult,
}));

import { runWrapped } from "../wrapper";

/**
 * The resolved launch mode the mocked resolver hands back. Ingestion with an
 * endpoint and a token, which is every pi run: pi is `allowVk: false`
 * (ADR-132 revision v10), so a gateway preference is downgraded before it ever
 * reaches here. `vars` is empty because pi is handed no environment block at
 * all (revision v9); that absence has its own test in
 * `pi-no-otel-env.unit.test.ts`.
 */
let modeResult: {
  mode: string;
  vars: Record<string, string>;
  clears: string[];
  endpoint: string;
  ingestionToken: string;
};

/** A sanitised copy of a real 132-row pi session, shared with the reader suites. */
const FIXTURE = join(__dirname, "fixtures", "pi-session-real-shape.jsonl");

/** Thrown in place of a real exit so the test can read the code. */
class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

let workDir: string;
let servers: Server[] = [];
let openSockets: Socket[] = [];
let originalPath: string | undefined;
let originalShell: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "lw-pi-noninterference-"));
  originalPath = process.env.PATH;
  originalShell = process.env.SHELL;
  // Force the direct-spawn branch: deterministic, and pi's capture block sits
  // above the branch, so nothing under test is skipped by taking it.
  process.env.SHELL = "";
});

afterEach(async () => {
  for (const socket of openSockets) socket.destroy();
  openSockets = [];
  for (const server of servers) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers = [];
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A server that records every body it is posted and answers 200. */
async function startRecordingServer(): Promise<{
  url: string;
  bodies: string[];
}> {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      bodies.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, bodies };
}

/**
 * A server that accepts the connection and never answers. This is the shape
 * that wedges a shell: a refused connection fails fast, a black hole does not.
 */
async function startBlackHoleServer(): Promise<{ url: string }> {
  const server = createServer((req) => {
    req.resume();
    // Deliberately no response, ever.
  });
  server.on("connection", (socket) => openSockets.push(socket));
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}` };
}

/** A port nothing is listening on, so the post is refused rather than hung. */
async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

interface RunOutcome {
  exitCode: number;
  stderr: string;
  piRan: boolean;
  /** Handles `setInterval` produced while the wrapper ran. */
  intervals: NodeJS.Timeout[];
  /** Handles handed to `clearInterval` while the wrapper ran. */
  cleared: unknown[];
  /** Handles still referenced — those would hold a real command open. */
  stillReferenced: NodeJS.Timeout[];
}

/**
 * One whole wrapped pi run: a real executable on PATH, a real session file, a
 * real post to `endpointBase`. Returns what a user would have observed.
 */
async function runPi({
  label,
  endpointBase,
  piExitCode,
}: {
  label: string;
  endpointBase: string;
  piExitCode: number;
}): Promise<RunOutcome> {
  const runDir = join(workDir, label);
  const binDir = join(runDir, "bin");
  const sessionsDir = join(runDir, "sessions");
  const marker = join(runDir, "pi-ran");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  // The recorded session is a real one from an earlier day, and capture keeps
  // only turns at or after the run's start — the row-level window that stops a
  // resumed session from being billed twice. Replayed verbatim, every row would
  // be correctly discarded as another run's work and this test would assert on
  // an empty wire. Rebasing the entry clock onto this run is what makes the
  // fixture mean "pi wrote this while we were watching", which is the thing
  // being tested; the row contents are untouched.
  const rebased = join(runDir, "session-now.jsonl");
  const rebaseFrom = Date.now();
  writeFileSync(
    rebased,
    readFileSync(FIXTURE, "utf8")
      .split("\n")
      .map((line, index) => {
        if (line.trim() === "") return line;
        const row = JSON.parse(line) as { timestamp?: string };
        if (typeof row.timestamp !== "string") return line;
        return JSON.stringify({
          ...row,
          timestamp: new Date(rebaseFrom + index).toISOString(),
        });
      })
      .join("\n"),
    "utf8",
  );

  // pi writes its session file and leaves, the way a short session does: the
  // file lands between the run's start stamp and the final sweep.
  writeFileSync(
    join(binDir, "pi"),
    `#!/bin/sh\ncp '${rebased}' '${join(sessionsDir, "session.jsonl")}'\nprintf 'ran\\n' > '${marker}'\nexit ${piExitCode}\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${binDir}:${originalPath ?? ""}`;

  modeResult = {
    mode: "ingestion",
    vars: {},
    clears: [],
    endpoint: endpointBase,
    ingestionToken: "lw_ingest_test_token",
  };

  const stderrChunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as never);

  const intervals: NodeJS.Timeout[] = [];
  const cleared: unknown[] = [];
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const handle = realSetInterval(...args);
    intervals.push(handle);
    return handle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
    cleared.push(handle);
    return realClearInterval(handle);
  }) as typeof clearInterval;

  let exitCode = -1;
  try {
    await runWrapped("pi", ["--session-dir", sessionsDir]);
    throw new Error("runWrapped returned without exiting");
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
    exitCode = err.code;
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }

  // Read before anything else tears the handles down: a timer still referenced
  // here is one that would have kept a real command alive.
  const stillReferenced = intervals.filter((handle) =>
    typeof handle.hasRef === "function" ? handle.hasRef() : true,
  );
  for (const handle of intervals) realClearInterval(handle);

  return {
    exitCode,
    stderr: stderrChunks.join(""),
    piRan: existsSync(marker),
    intervals,
    cleared,
    stillReferenced,
  };
}

/** How many turn records the delivered OTLP bodies carried between them. */
function deliveredRecordCount(bodies: readonly string[]): number {
  return bodies.reduce((total, raw) => {
    const parsed = JSON.parse(raw) as {
      resourceLogs?: { scopeLogs?: { logRecords?: unknown[] }[] }[];
    };
    let count = total;
    for (const resourceLog of parsed.resourceLogs ?? []) {
      for (const scopeLog of resourceLog.scopeLogs ?? []) {
        count += scopeLog.logRecords?.length ?? 0;
      }
    }
    return count;
  }, 0);
}

const UNDELIVERED = /(\d+) pi turns? could not be sent to LangWatch/;

describe("running pi through the wrapper", () => {
  describe("given a capture that cannot reach LangWatch", () => {
    /** @scenario "Capture that cannot reach LangWatch does not disturb the coding session" */
    it("hands back pi's own exit code and reports the turns it could not send", async () => {
      // Control first, the way the shell-reapply sibling does: prove capture is
      // genuinely wired in this harness, and learn what this session is worth
      // in turns, so the failure below is a real failure of a real capture
      // rather than a capture that never ran at all.
      const live = await startRecordingServer();
      const reachable = await runPi({
        label: "reachable",
        endpointBase: live.url,
        piExitCode: 42,
      });
      expect(reachable.piRan).toBe(true);
      expect(reachable.exitCode).toBe(42);
      const delivered = deliveredRecordCount(live.bodies);
      expect(delivered).toBeGreaterThan(0);
      expect(reachable.stderr).not.toMatch(UNDELIVERED);

      // The same session again, with nothing listening.
      const unreachable = await runPi({
        label: "unreachable",
        endpointBase: await closedPortUrl(),
        piExitCode: 42,
      });

      // pi ran to completion and the command gave back pi's code, not its own.
      expect(unreachable.piRan).toBe(true);
      expect(unreachable.exitCode).toBe(42);

      // And capture did try: the turns the live endpoint received are exactly
      // the ones reported undelivered here.
      const reported = UNDELIVERED.exec(unreachable.stderr);
      expect(reported).not.toBeNull();
      expect(Number(reported![1])).toBe(delivered);
    });
  });

  describe("given an endpoint that accepts the connection and never answers", () => {
    /** @scenario "The command exits when pi exits" */
    it("exits with pi instead of waiting on the post, and leaves no timer running", async () => {
      const blackHole = await startBlackHoleServer();

      const outcome = await runPi({
        label: "black-hole",
        endpointBase: blackHole.url,
        piExitCode: 0,
      });

      // Reaching here at all is the assertion: the final sweep is bounded, so
      // the command exits rather than hanging on an endpoint that never
      // answers. An unbounded post fails this test by timing out, not by
      // asserting.
      expect(outcome.piRan).toBe(true);
      expect(outcome.exitCode).toBe(0);

      // The poll exists — so the two checks after it are not vacuous — is
      // unreferenced so it can never be the thing keeping the command alive,
      // and is cleared before the final sweep.
      expect(outcome.intervals).toHaveLength(1);
      expect(outcome.stillReferenced).toEqual([]);
      expect(outcome.cleared).toContain(outcome.intervals[0]);
    });
  });
});
