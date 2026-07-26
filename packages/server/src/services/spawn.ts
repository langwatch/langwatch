import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	unlinkSync,
	type WriteStream,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { EventBus } from "./event-bus.ts";
import type { ServiceName, ServicePaths } from "./paths.ts";

export type SpawnSpec = {
	name: ServiceName;
	command: string;
	args: string[];
	env: NodeJS.ProcessEnv;
	cwd?: string;
};

export type SupervisedHandle = {
	name: string;
	pid: number;
	child: ChildProcess;
	stop(): Promise<void>;
};

export type RestartPolicy = {
	/** Restarts granted to a service that crashes after having been healthy. */
	maxRestarts: number;
	/** Delay before each restart attempt; the last entry repeats if the list is shorter than maxRestarts. */
	backoffMs: readonly number[];
	/** Uptime after which the restart counter resets to zero. */
	steadyUptimeMs: number;
};

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
	maxRestarts: 3,
	backoffMs: [1_000, 5_000, 15_000],
	steadyUptimeMs: 5 * 60_000,
};

/**
 * Spawn a child process under supervision: tee stdout/stderr to its log file
 * AND emit "log" events on the bus so the CLI can render to TTY. Writes a
 * pidfile so a stale process can be detected on the next CLI run.
 *
 * Crash policy: a crash before the service's first "healthy" event is a boot
 * failure and fails fast with a "crashed" event, exactly once. A crash after
 * the service has been healthy is retried in place with bounded backoff
 * (announced via "restarting" events); staying up for `steadyUptimeMs`
 * refills the budget. When the budget is exhausted the crash falls through
 * to the "crashed" event. Supervision learns about "healthy" by observing
 * the bus; the health probes live in each service's start helper.
 *
 * The returned handle's `stop()` sends SIGTERM, waits up to 10s for clean
 * exit, then SIGKILLs. It also cancels any pending restart. Idempotent.
 * `pid` and `child` always reflect the current (most recently spawned)
 * process.
 */
export function supervise({
	spec,
	paths,
	bus,
	restartPolicy = DEFAULT_RESTART_POLICY,
}: {
	spec: SpawnSpec;
	paths: ServicePaths;
	bus: EventBus;
	restartPolicy?: RestartPolicy;
}): SupervisedHandle {
	const logPath = paths.log(spec.name);
	const pidPath = paths.pid(spec.name);
	mkdirSync(dirname(logPath), { recursive: true });
	mkdirSync(dirname(pidPath), { recursive: true });

	let currentChild!: ChildProcess;
	let stopped = false;
	let hasBeenHealthy = false;
	let restartCount = 0;
	let backoffTimer: NodeJS.Timeout | null = null;
	let steadyTimer: NodeJS.Timeout | null = null;

	const untap = bus.tap((ev) => {
		if (ev.type === "healthy" && ev.service === spec.name)
			hasBeenHealthy = true;
	});

	const clearSteadyTimer = (): void => {
		if (steadyTimer) {
			clearTimeout(steadyTimer);
			steadyTimer = null;
		}
	};

	const handleExit = ({
		code,
		signal,
		logStream,
	}: {
		code: number | null;
		signal: NodeJS.Signals | null;
		logStream: WriteStream;
	}): void => {
		const isCrash = !stopped && (code !== 0 || signal !== null);
		if (!isCrash) {
			logStream.end();
			untap();
			bus.emit({ type: "stopped", service: spec.name });
			return;
		}

		const cause = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
		if (hasBeenHealthy && restartCount < restartPolicy.maxRestarts) {
			restartCount += 1;
			const attempt = restartCount;
			const delayMs =
				restartPolicy.backoffMs[
					Math.min(attempt, restartPolicy.backoffMs.length) - 1
				] ?? 1_000;
			logStream.write(
				`[supervisor] ${spec.name} exited (${cause}), restarting in ${delayMs}ms (attempt ${attempt}/${restartPolicy.maxRestarts})\n`,
			);
			logStream.end();
			bus.emit({
				type: "restarting",
				service: spec.name,
				code: code ?? -1,
				signal: signal ?? undefined,
				attempt,
				maxAttempts: restartPolicy.maxRestarts,
				delayMs,
			});
			backoffTimer = setTimeout(() => {
				backoffTimer = null;
				if (stopped) return;
				spawnAttempt();
			}, delayMs);
			return;
		}

		const reason = hasBeenHealthy
			? "restart budget exhausted"
			: "died before first healthy";
		logStream.write(
			`[supervisor] ${spec.name} exited (${cause}), ${reason}, not restarting\n`,
		);
		logStream.end();
		untap();
		bus.emit({
			type: "crashed",
			service: spec.name,
			code: code ?? -1,
			signal: signal ?? undefined,
		});
	};

	const spawnAttempt = (): void => {
		const logStream = createWriteStream(logPath, { flags: "a" });
		const child = nodeSpawn(spec.command, spec.args, {
			env: spec.env,
			cwd: spec.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
		});
		currentChild = child;

		if (typeof child.pid === "number") {
			writeFileSync(pidPath, String(child.pid));
		}

		// Track stdout + stderr "end" events so we can drain any buffered lines
		// BEFORE closing the log file. If we end() the logStream synchronously
		// on child 'exit', the readline transformer may still be flushing the
		// last chunk and we lose tail data, caught by spawn.integration.test
		// intermittently failing on the 'row-2' assertion. Wait for both pipes
		// to finish before closing.
		const pipesDrained: Promise<void>[] = [
			pipeLines(child, "stdout", spec.name, logStream, bus),
			pipeLines(child, "stderr", spec.name, logStream, bus),
		];

		clearSteadyTimer();
		steadyTimer = setTimeout(() => {
			steadyTimer = null;
			restartCount = 0;
		}, restartPolicy.steadyUptimeMs);

		child.on("exit", (code, signal) => {
			safeUnlink(pidPath);
			clearSteadyTimer();
			void Promise.all(pipesDrained).then(() =>
				handleExit({ code, signal, logStream }),
			);
		});
	};

	spawnAttempt();

	const stop = async (): Promise<void> => {
		if (stopped) return;
		stopped = true;
		untap();
		if (backoffTimer) {
			// The child already exited and a respawn is pending: cancel it. No
			// process is running, so this is the service's terminal event.
			clearTimeout(backoffTimer);
			backoffTimer = null;
			clearSteadyTimer();
			bus.emit({ type: "stopped", service: spec.name });
			return;
		}
		clearSteadyTimer();
		const child = currentChild;
		const hasExited = child.exitCode !== null || child.signalCode !== null;
		if (hasExited || !child.pid || child.killed) return;
		child.kill("SIGTERM");
		const exit = waitForExit(child, 10_000);
		if (await exit) return;
		child.kill("SIGKILL");
		await waitForExit(child, 5_000);
	};

	return {
		name: spec.name,
		get pid() {
			return currentChild.pid ?? -1;
		},
		get child() {
			return currentChild;
		},
		stop,
	};
}

function pipeLines(
	child: ChildProcess,
	streamName: "stdout" | "stderr",
	service: ServiceName,
	logStream: WriteStream,
	bus: EventBus,
): Promise<void> {
	const stream = child[streamName];
	if (!stream) return Promise.resolve();
	const rl = createInterface({ input: stream });
	rl.on("line", (line) => {
		logStream.write(`${line}\n`);
		bus.emit({ type: "log", service, stream: streamName, line });
	});
	// Resolve when readline finishes draining the pipe (stream EOF). The
	// child's 'exit' handler awaits this before closing the logStream so
	// the last lines aren't truncated.
	return new Promise<void>((resolve) => rl.once("close", () => resolve()));
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

function safeUnlink(path: string): void {
	try {
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// ignore
	}
}
