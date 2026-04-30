// Contract module shared between the CLI flow (smith) and the runtime
// implementation (julia). The CLI calls these functions; julia owns the
// implementation in services/runtime.ts. Keep this file backward compatible
// — adding fields is fine, removing or renaming is a coordinated change.

import type { PortAllocation } from "../shared/ports.ts";
import type { LangwatchPaths } from "../shared/paths.ts";
import type { PredepResult } from "../predeps/runner.ts";

export type RuntimeContext = {
  ports: PortAllocation;
  paths: LangwatchPaths;
  predeps: PredepResult;
  envFile: string;
  version: string;
  /** Opt-in: start bullboard alongside the rest. CLI flag `--bullboard`. */
  bullboard: boolean;
  /**
   * NLP runtime backend. `go` (default) runs the Go nlpgo service from
   * the aigateway monobinary; `python` runs the legacy uvicorn-served
   * langwatch_nlp project under uv. CLI flag `--nlp <python|go>`. The
   * scaffolded .env's FEATURE_FLAG_FORCE_ENABLE block is gated on this
   * so the langwatch app routes /studio/* traffic to the matching
   * upstream — see shared/env.ts buildEnv.
   */
  nlpMode: "python" | "go";
  /** Pass-through env from the user shell (OPENAI_API_KEY, …) — propagated to children, never persisted. */
  userEnv: Record<string, string>;
};

export type ServiceHandle = {
  name: string;
  pid: number;
  stop(): Promise<void>;
};

/**
 * Events emitted by the runtime supervisor while installing/starting/running
 * services. The CLI consumes this stream to render the listr2 status grid
 * and to tee log lines to TTY (with stable per-service prefix + color).
 *
 * The stream stays open from the moment `events(ctx)` is called until
 * `stopAll(handles)` resolves. Multiple consumers are not supported — call
 * `events(ctx)` exactly once per CLI run.
 */
export type RuntimeEvent =
  | { type: "starting"; service: string }
  | { type: "healthy"; service: string; durationMs: number }
  | { type: "log"; service: string; stream: "stdout" | "stderr"; line: string }
  | { type: "crashed"; service: string; code: number; signal?: NodeJS.Signals }
  | { type: "stopped"; service: string };

export type RuntimeApi = {
  scaffoldEnv(ctx: RuntimeContext): Promise<{ written: boolean; path: string }>;
  installServices(ctx: RuntimeContext): Promise<void>;
  startAll(ctx: RuntimeContext): Promise<ServiceHandle[]>;
  waitForHealth(ctx: RuntimeContext, opts: { timeoutMs: number }): Promise<void>;
  stopAll(handles: ServiceHandle[]): Promise<void>;
  events(ctx: RuntimeContext): AsyncIterable<RuntimeEvent>;
};
