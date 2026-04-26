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
};

export type ServiceHandle = {
  name: string;
  pid: number;
  stop(): Promise<void>;
};

export type RuntimeApi = {
  installServices(ctx: RuntimeContext): Promise<void>;
  scaffoldEnv(ctx: RuntimeContext): Promise<{ written: boolean; path: string }>;
  startAll(ctx: RuntimeContext): Promise<ServiceHandle[]>;
  waitForHealth(ctx: RuntimeContext, opts: { timeoutMs: number }): Promise<void>;
  stopAll(handles: ServiceHandle[]): Promise<void>;
};
