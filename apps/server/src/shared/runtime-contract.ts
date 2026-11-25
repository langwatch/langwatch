// Contract module shared between the CLI flow (smith) and the runtime
// implementation (julia). The CLI calls these functions; julia owns the
// implementation in services/runtime.ts. Keep this file backward compatible:
// adding fields is fine, removing or renaming is a coordinated change.

import type { LocalOrchestratorConfig } from "../platform/config/local-orchestrator.config.ts";
import type { PredepResult } from "../predeps/runner.ts";
import type { PredepId } from "../predeps/types.ts";
import type { LangwatchPaths } from "../shared/paths.ts";
import type { PortAllocation } from "../shared/ports.ts";

export type RuntimeContext = {
  ports: PortAllocation;
  paths: LangwatchPaths;
  predeps: PredepResult;
  envFile: string;
  version: string;
  /** User shell env (OPENAI_API_KEY, …); propagated to children, never persisted. */
  userEnv: Record<string, string>;
  /** Immutable launcher settings projected during CLI composition. */
  orchestrator: LocalOrchestratorConfig;
  /**
   * Resolves once each named predep is in `predeps`, rejects if one did not install, so a
   * service starts while the others still download. Absent: every predep is already there.
   */
  predepsReady?: (ids: readonly PredepId[]) => Promise<void>;
  /**
   * Like predepsReady, for a predep a service can do without: false once one was skipped after
   * its install failed. Absent: the answer follows predepsReady.
   */
  predepsPresent?: (ids: readonly PredepId[]) => Promise<boolean>;
  /** The level every service starts at (shared/log-level.ts). Absent: warn. */
  logLevel?: string;
};

export type ServiceHandle = {
  name: string;
  pid: number;
  stop(): Promise<void>;
};

// Runtime supervisor events. Stream stays open until stopAll() resolves.
export type RuntimeEvent =
  | { type: "starting"; service: string }
  | { type: "healthy"; service: string; durationMs: number }
  | {
      type: "log";
      service: string;
      stream: "stdout" | "stderr";
      line: string;
      /** The CLI's own notice about a service: shown at every level, unlike its output. */
      isNotice?: boolean;
    }
  /**
   * A previously-healthy service crashed and the supervisor is bringing it
   * back after `delayMs`. Emitted instead of "crashed" while restart budget
   * remains; when the budget runs out the crash falls through to "crashed".
   */
  | {
      type: "restarting";
      service: string;
      code: number;
      signal?: NodeJS.Signals;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
    }
  | { type: "crashed"; service: string; code: number; signal?: NodeJS.Signals }
  | { type: "stopped"; service: string };

/**
 * Formats a process exit identically everywhere it's reported —
 * spawn.ts's log markers and log-tee.ts's TTY render both call this
 * instead of keeping their own copy.
 */
export function exitCause({
  code,
  signal,
}: {
  code: number | null;
  signal?: NodeJS.Signals | null;
}): string {
  return signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
}

export type RuntimeApi = {
  scaffoldEnv(
    ctx: RuntimeContext,
    opts?: { shouldReconcilePorts?: boolean },
  ): Promise<{ written: boolean; path: string; reconciledKeys: string[] }>;
  installServices(ctx: RuntimeContext): Promise<void>;
  startAll(ctx: RuntimeContext): Promise<ServiceHandle[]>;
  waitForHealth(ctx: RuntimeContext, opts: { timeoutMs: number }): Promise<void>;
  stopAll(handles: ServiceHandle[]): Promise<void>;
  events(ctx: RuntimeContext): AsyncIterable<RuntimeEvent>;
};
