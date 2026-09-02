import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerExecutableHost, WorkerExecutableOptions } from "../worker.executable";
import { WorkerExecutable, WorkerExecutableCompositionPort } from "../worker.executable";
import type { WorkerProcessComposition, WorkerProcessFactoryContext } from "../worker.process";

const mocks = vi.hoisted(() => ({
  configureLogger: vi.fn(),
  createObservability: vi.fn(),
  shutdown: vi.fn(async () => undefined),
  logger: { info: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    configureLogger: mocks.configureLogger,
  };
});

vi.mock("@langwatch/observability/node", () => ({
  createProcessObservability: mocks.createObservability,
  // The worker's config resolution folds telemetry leaves through this, and
  // boot starts the export from the result. Both are named here so the mock
  // is the whole module the process imports rather than the half it used to.
  otlpMetricsExportOptionsFrom: () => ({
    endpoint: undefined,
    enabled: false,
    headers: {},
    resourceAttributes: {},
    serviceName: "worker",
    deploymentEnvironment: undefined,
  }),
  startOtlpMetricsExport: () => undefined,
}));

class Host implements WorkerExecutableHost {
  readonly exits: number[] = [];
  private readonly signals = new Map<string, Set<() => void>>();
  private readonly uncaught = new Set<(error: Error) => void>();
  private readonly rejections = new Set<(reason: unknown, promise: Promise<unknown>) => void>();

  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    const listeners = this.signals.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.signals.set(signal, listeners);
  }

  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.signals.get(signal)?.delete(listener);
  }

  onUncaughtException(listener: (error: Error) => void): void {
    this.uncaught.add(listener);
  }

  offUncaughtException(listener: (error: Error) => void): void {
    this.uncaught.delete(listener);
  }

  onUnhandledRejection(listener: (reason: unknown, promise: Promise<unknown>) => void): void {
    this.rejections.add(listener);
  }

  offUnhandledRejection(listener: (reason: unknown, promise: Promise<unknown>) => void): void {
    this.rejections.delete(listener);
  }

  exit(code: number): void {
    this.exits.push(code);
  }

  emitSignal(signal: "SIGINT" | "SIGTERM"): void {
    for (const listener of this.signals.get(signal) ?? []) listener();
  }

  emitUncaught(error: Error): void {
    for (const listener of this.uncaught) listener(error);
  }

  emitRejection(reason: unknown, promise: Promise<unknown>): void {
    for (const listener of this.rejections) listener(reason, promise);
  }

  signalListenerCount(signal: "SIGINT" | "SIGTERM"): number {
    return this.signals.get(signal)?.size ?? 0;
  }

  get uncaughtListenerCount(): number {
    return this.uncaught.size;
  }

  get rejectionListenerCount(): number {
    return this.rejections.size;
  }
}

class Composition extends WorkerExecutableCompositionPort {
  readonly compose = vi.fn(async (_context: WorkerProcessFactoryContext) => this.process);

  constructor(readonly process: WorkerProcessComposition) {
    super();
  }
}

function application(): WorkerProcessComposition {
  return {
    application: {
      start: vi.fn(async () => undefined),
      drain: vi.fn(async () => undefined),
      closeResources: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    },
  };
}

function options(host: Host, composition: Composition): WorkerExecutableOptions {
  return { source: { NODE_ENV: "test" }, host, composition };
}

describe("WorkerExecutable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shutdown.mockResolvedValue(undefined);
    mocks.createObservability.mockReturnValue({
      logger: mocks.logger,
      tracer: {},
      shutdown: mocks.shutdown,
    });
  });

  it("validates boot configuration before composing a Worker graph", async () => {
    const host = new Host();
    const composition = new Composition(application());

    await expect(
      WorkerExecutable.boot({ ...options(host, composition), source: { NODE_ENV: "invalid" } }),
    ).rejects.toThrow("Invalid worker configuration");

    expect(composition.compose).not.toHaveBeenCalled();
    expect(host.signalListenerCount("SIGTERM")).toBe(0);
  });

  it("starts one composed graph and sends a successful signal shutdown through Worker lifecycle", async () => {
    const host = new Host();
    const process = application();
    const composition = new Composition(process);
    const executable = await WorkerExecutable.boot(options(host, composition));

    await executable.start();
    host.emitSignal("SIGTERM");

    await vi.waitFor(() => expect(host.exits).toEqual([0]));
    expect(process.application.start).toHaveBeenCalledOnce();
    expect(process.application.drain).toHaveBeenCalledOnce();
    expect(process.application.closeResources).toHaveBeenCalledOnce();
    expect(mocks.shutdown).toHaveBeenCalledOnce();
    expect(host.uncaughtListenerCount).toBe(0);
    expect(host.rejectionListenerCount).toBe(0);
  });

  it("reports fatal process errors and retains the legacy exit-one policy", async () => {
    const host = new Host();
    const executable = await WorkerExecutable.boot(options(host, new Composition(application())));
    const error = new Error("uncaught");

    host.emitUncaught(error);
    host.emitRejection("rejected", Promise.resolve());

    expect(mocks.logger.fatal).toHaveBeenNthCalledWith(1, { error }, "uncaught exception detected");
    expect(mocks.logger.fatal).toHaveBeenNthCalledWith(
      2,
      { reason: { value: "rejected" }, promise: expect.any(Promise) },
      "unhandled rejection detected",
    );
    expect(host.exits).toEqual([1, 1]);

    await executable.close();
  });

  it("removes every host listener when closed manually", async () => {
    const host = new Host();
    const executable = await WorkerExecutable.boot(options(host, new Composition(application())));

    await executable.close();

    expect(host.signalListenerCount("SIGINT")).toBe(0);
    expect(host.signalListenerCount("SIGTERM")).toBe(0);
    expect(host.uncaughtListenerCount).toBe(0);
    expect(host.rejectionListenerCount).toBe(0);
  });
});
