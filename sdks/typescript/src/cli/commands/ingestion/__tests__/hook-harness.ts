/**
 * The fakes the session context hook suites share: a collector that records
 * what it was posted, a git runner that answers from a table, a temporary
 * fingerprint directory, and the stdout/exit capture that both of the hook's
 * promises to a session are asserted against.
 *
 * Not named `*.test.ts` on purpose. Vitest's `include` is `src/**\/*.test.ts`,
 * so this module is imported by the suites rather than collected as one.
 *
 * Feature: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, vi } from "vitest";

import { hookCommand } from "../hook";
import type { GitRunner } from "../git-context";

export const ENDPOINT = "http://app.example.com/api/otel";
export const SESSION_ID = "0199a1f4-2c5e-7a10-9f61-2d7f0a3b5c11";
export const TRACEPARENT =
  "00-16872e6253edb3e8748023ff172703c4-be7ce7c6bf1173f5-01";
export const NOW = 1_700_000_000_000;

/** A linked worktree of langwatch/langwatch, checked out on a feature branch. */
export const WORKTREE_GIT: Record<string, string> = {
  "remote get-url origin": "git@github.com:langwatch/langwatch.git",
  "branch --show-current": "feat/session-context",
  "rev-parse --git-dir": "/repo/.git/worktrees/review",
  "rev-parse --git-common-dir": "/repo/.git",
  "rev-parse --show-toplevel": "/repo/worktrees/review",
};

/** A CLI that was never signed in, so the config fallback names no collector. */
export const NO_CLI_CONFIG = () => ({});

/** Answers git from a table keyed by the joined arguments. */
export const gitRunner =
  (responses: Record<string, string>): GitRunner =>
  ({ args }) =>
    responses[args.join(" ")] ?? null;

export interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

export interface OtlpBody {
  resourceLogs: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeLogs: Array<{
      scope: { name: string; version: string };
      logRecords: Array<{
        eventName: string;
        timeUnixNano: string;
        attributes: OtlpAttribute[];
        traceId?: string;
        spanId?: string;
      }>;
    }>;
  }>;
}

export interface PostedRequest {
  url: string;
  headers: Record<string, string>;
  body: OtlpBody;
}

/** A collector that is not there at all. */
export const unreachableCollector: typeof fetch = (async () => {
  throw new Error("connect ECONNREFUSED");
}) as unknown as typeof fetch;

export const attributesOf = (
  request: PostedRequest,
): Record<string, string> =>
  Object.fromEntries(
    request.body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes.map(
      (attribute) => [attribute.key, attribute.value.stringValue],
    ),
  );

export const recordOf = (request: PostedRequest) =>
  request.body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;

export interface RunHookOptions {
  input?: Record<string, unknown> | string;
  /**
   * Hands the command its own payload reader, for the runs where how the
   * payload arrives is the point. Defaults to serving `input` straight back.
   */
  readInput?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
  git?: Record<string, string>;
  /** Full control over git answers, for runs where the directory matters. */
  runGit?: GitRunner;
  fetchImpl?: typeof fetch;
  now?: number;
  tool?: string;
  /** Claude's live session registry. Defaults to an empty per-test one. */
  claudeRegistryDir?: string;
  readCliConfig?: Parameters<typeof hookCommand>[0]["readCliConfig"];
  /**
   * Run with no exporter variables at all, the way Claude Code hands its hooks
   * an environment. Every other run seeds `OTEL_EXPORTER_OTLP_ENDPOINT`.
   */
  shouldOmitExporterEnv?: boolean;
}

export interface HookHarness {
  /** Every request the collector received, in order. */
  posted: PostedRequest[];
  /** Anything the command wrote to stdout. Empty, by contract. */
  stdout: string[];
  /** Exit codes the command asked for. Empty, by contract. */
  exits: number[];
  /** This test's fingerprint directory. */
  readonly stateDir: string;
  /** This test's claude session registry directory (not created). */
  readonly claudeRegistryDir: string;
  /** A collector answering `status`, recording into `posted`. */
  collector(status?: number): typeof fetch;
  runHook(options?: RunHookOptions): Promise<void>;
}

/**
 * Registers the hooks in the CALLING suite and returns the live buffers.
 *
 * The buffers are emptied in place rather than reassigned, so a suite may
 * destructure them once at module scope and still read what the current test
 * produced.
 */
export const installHookHarness = (): HookHarness => {
  const posted: PostedRequest[] = [];
  const stdout: string[] = [];
  const exits: number[] = [];
  let stateDir = "";

  const collector =
    (status = 200): typeof fetch =>
    ((url: string, init: { headers: Record<string, string>; body: string }) => {
      posted.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body) as OtlpBody,
      });
      return Promise.resolve(new Response("{}", { status }));
    }) as unknown as typeof fetch;

  beforeEach(() => {
    posted.length = 0;
    stdout.length = 0;
    exits.length = 0;
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-hook-state-"));
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exits.push(code ?? 0);
      return undefined as never;
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  return {
    posted,
    stdout,
    exits,
    get stateDir() {
      return stateDir;
    },
    get claudeRegistryDir() {
      return path.join(stateDir, "claude-sessions");
    },
    collector,
    runHook: ({
      input = { session_id: SESSION_ID, cwd: "/repo/worktrees/review" },
      readInput,
      env = {},
      git = WORKTREE_GIT,
      runGit,
      fetchImpl = collector(),
      now = NOW,
      tool = "claude-code",
      claudeRegistryDir,
      readCliConfig = NO_CLI_CONFIG,
      shouldOmitExporterEnv = false,
    }: RunHookOptions = {}) =>
      hookCommand({
        tool,
        env: shouldOmitExporterEnv
          ? env
          : { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT, ...env },
        readInput:
          readInput ??
          (() =>
            Promise.resolve(
              typeof input === "string" ? input : JSON.stringify(input),
            )),
        runGit: runGit ?? gitRunner(git),
        fetchImpl,
        now: () => now,
        stateDir,
        // Empty by default, so no test ever reads the machine's real
        // registry and finds a name it did not plant.
        claudeRegistryDir: claudeRegistryDir ?? path.join(stateDir, "claude-sessions"),
        readCliConfig,
      }),
  };
};
