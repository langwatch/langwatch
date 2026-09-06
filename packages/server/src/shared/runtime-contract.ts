// Contract module shared between the CLI flow (smith) and the runtime
// implementation (julia). The CLI calls these functions; julia owns the
// implementation in services/runtime.ts. Keep this file backward compatible:
// adding fields is fine, removing or renaming is a coordinated change.

import type { PredepResult } from "../predeps/runner.ts";
import type { LangwatchPaths } from "../shared/paths.ts";
import type { PortAllocation } from "../shared/ports.ts";

export type RuntimeContext = {
	ports: PortAllocation;
	paths: LangwatchPaths;
	predeps: PredepResult;
	envFile: string;
	version: string;
	/** Pass-through env from the user shell (OPENAI_API_KEY, …), propagated to children, never persisted. */
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
 * `stopAll(handles)` resolves. Multiple consumers are not supported: call
 * `events(ctx)` exactly once per CLI run.
 */
export type RuntimeEvent =
	| { type: "starting"; service: string }
	| { type: "healthy"; service: string; durationMs: number }
	| { type: "log"; service: string; stream: "stdout" | "stderr"; line: string }
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
 * Format a process exit the same way everywhere it is reported: the
 * supervisor's log-file marker lines (spawn.ts) and the CLI's TTY render
 * (log-tee.ts) must read identically, so both call this instead of keeping
 * their own copy.
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
	waitForHealth(
		ctx: RuntimeContext,
		opts: { timeoutMs: number },
	): Promise<void>;
	stopAll(handles: ServiceHandle[]): Promise<void>;
	events(ctx: RuntimeContext): AsyncIterable<RuntimeEvent>;
};
