/**
 * One shutdown implementation, shared by every process entrypoint. Hand-rolled
 * sequences agreed on the order but not on the deadline, and the guard, the
 * watchdog and the phase logging each lived in only one of them.
 */

export interface ShutdownPhase {
  /** Named so a phase that hangs is identifiable in the logs. */
  name: string;
  run: () => Promise<void> | void;
  /**
   * How long this phase may take before the sequence moves on without it. A phase that never
   * settles takes the whole shutdown with it, drain included: a websocket close resolves only
   * once every client has gone, so one suspended tab holds it open indefinitely.
   */
  timeoutMs?: number;
  /**
   * Marks the phase that drains live work rather than releasing handles. It
   * matters only in a `terminating` shutdown: see {@link GracefulShutdown}.
   */
  drainPhase?: boolean;
}

/**
 * Default ceiling for a phase that does not name its own. Sized so the common
 * shutdown fits several phases inside the process deadline; a drain phase that
 * legitimately needs the whole budget overrides it.
 */
const DEFAULT_PHASE_TIMEOUT_MS = 10_000;

/**
 * A phase that outran its budget, as distinct from one that threw. A phase that
 * threw has FINISHED; one that timed out is still running, so tearing down what
 * it is using severs live work rather than releasing idle handles.
 */
export class ShutdownPhaseTimeoutError extends Error {
  constructor(
    readonly phase: string,
    readonly timeoutMs: number,
  ) {
    super(`shutdown phase "${phase}" did not finish within ${timeoutMs}ms`);
    this.name = "ShutdownPhaseTimeoutError";
  }
}

export interface ShutdownLogger {
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

/** The signals a process boundary answers, as this runner needs them. */
export interface ShutdownSignalHost {
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  off?(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

export interface GracefulShutdownOptions {
  logger: ShutdownLogger;
  /**
   * The watchdog ceiling for the whole sequence. Omitted, there is no
   * watchdog: a process whose signal boundary already owns a deadline would
   * otherwise run two, and the second one exits behind the first's back.
   */
  deadlineMs?: number;
  /** Overridable for tests, which must not kill the runner. */
  exit?: (code: number) => never;
  /**
   * Whether this process is dying. A timed-out `drainPhase` is STILL RUNNING,
   * so a terminating process stops there and leaves its handles to teardown; a
   * process that stays up releases them, since nothing else will reclaim them.
   */
  terminating?: boolean;
}

/**
 * The phases of one process's teardown, in order, under one watchdog and one
 * signal guard. Each process composition builds its own instance and states
 * its own phases; nothing registers into it from a module scope.
 */
export class GracefulShutdown {
  static create(options: GracefulShutdownOptions): GracefulShutdown {
    return new GracefulShutdown(
      options.logger,
      options.deadlineMs,
      options.exit ?? (process.exit.bind(process) as (code: number) => never),
      options.terminating === true,
    );
  }

  private readonly phases: ShutdownPhase[] = [];
  private shuttingDown = false;

  private constructor(
    private readonly logger: ShutdownLogger,
    private readonly deadlineMs: number | undefined,
    private readonly exit: (code: number) => never,
    private readonly terminating: boolean,
  ) {}

  /** Appends one phase. Order is the order phases were added. */
  phase(phase: ShutdownPhase): this {
    this.phases.push(phase);
    return this;
  }

  /**
   * Runs each phase in order, logging a failure or timeout against the phase name and stepping
   * over it, and returns the first failure for a caller that still owes its own error contract.
   * Phases are sequential because each tears down something the next still needs.
   */
  async run(options: { signal?: string } = {}): Promise<unknown> {
    const signal = options.signal;
    this.logger.info({ signal, deadlineMs: this.deadlineMs }, "shutting down");

    const deadline = this.startDeadline(signal);
    try {
      return await this.runPhases();
    } finally {
      if (deadline) clearTimeout(deadline);
      this.logger.info({ signal }, "graceful shutdown complete");
    }
  }

  /**
   * Wires SIGTERM/SIGINT to one run followed by one exit. Kubernetes sends
   * SIGTERM and an impatient operator adds a Ctrl-C on top; without the guard
   * the second signal starts a parallel teardown over half-closed handles.
   */
  installSignalHandlers(options: { host?: ShutdownSignalHost } = {}): () => void {
    const host = options.host ?? process;
    const handleTerm = () => this.handleSignal("SIGTERM");
    const handleInt = () => this.handleSignal("SIGINT");
    host.on("SIGTERM", handleTerm);
    host.on("SIGINT", handleInt);
    return () => {
      host.off?.("SIGTERM", handleTerm);
      host.off?.("SIGINT", handleInt);
    };
  }

  private handleSignal(signal: "SIGTERM" | "SIGINT"): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    void this.run({ signal }).then(() => this.exit(0));
  }

  /**
   * Deliberately NOT unref'd, and cleared by `run`'s finally. Unref'd, a phase
   * stalling on something that is not a handle empties the loop, Node exits 0,
   * and a shutdown that never drained reports success.
   */
  private startDeadline(signal: string | undefined): ReturnType<typeof setTimeout> | undefined {
    const deadlineMs = this.deadlineMs;
    if (deadlineMs === undefined) return undefined;
    return setTimeout(() => {
      this.logger.error(
        { signal, deadlineMs },
        "graceful shutdown exceeded its deadline, exiting before the pod is killed",
      );
      this.exit(1);
    }, deadlineMs);
  }

  private async runPhases(): Promise<unknown> {
    let firstError: unknown;
    for (const phase of this.phases) {
      const error = await this.runPhase(phase);
      if (error === undefined) continue;

      if (
        this.terminating &&
        phase.drainPhase === true &&
        error instanceof ShutdownPhaseTimeoutError
      ) {
        this.logger.info(
          { phase: phase.name },
          "drain outran its budget and is still running; leaving connections to process teardown",
        );
        return firstError;
      }
      firstError ??= error;
    }
    return firstError;
  }

  private async runPhase(phase: ShutdownPhase): Promise<unknown> {
    const phaseTimeoutMs = phase.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(phase.run),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ShutdownPhaseTimeoutError(phase.name, phaseTimeoutMs)),
            phaseTimeoutMs,
          );
        }),
      ]);
      return undefined;
    } catch (error) {
      // Logged and stepped over, whether it threw or timed out. A websocket
      // server that will not close must not cost us the queue drain that comes
      // after it — that drain is the reason this sequence exists.
      this.logger.error({ error, phase: phase.name }, "shutdown phase failed");
      return error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
