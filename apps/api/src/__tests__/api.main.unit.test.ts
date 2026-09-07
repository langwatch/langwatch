import { describe, expect, it, vi } from "vitest";
import {
  ApiRuntimeBootstrap,
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main.ts";
import type { ApiShutdownSignal, ApiSignalHost } from "../api.signal-handlers.ts";

class TestProcess extends ApiRuntimeProcessPort {
  readonly start = vi.fn<() => Promise<undefined>>(async () => void 0);
  readonly close = vi.fn<() => Promise<undefined>>(async () => void 0);
}

class TestComposition extends ApiRuntimeCompositionPort {
  readonly compose = vi.fn<(options: ApiRuntimeCompositionOptions) => Promise<TestProcess>>(
    async (_options) => this.process,
  );

  constructor(readonly process: TestProcess) {
    super();
  }
}

class TestSignalHost implements ApiSignalHost {
  private readonly listeners = new Map<ApiShutdownSignal, Set<() => void>>();

  on(signal: ApiShutdownSignal, listener: () => void): void {
    const listeners = this.listeners.get(signal) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(signal, listeners);
  }

  off(signal: ApiShutdownSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }

  emit(signal: ApiShutdownSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) listener();
  }
}

describe("ApiRuntimeBootstrap", () => {
  /** @scenario "The API validates its configuration before it composes or listens" */
  it("rejects invalid config before it composes a graph or starts a listener", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);

    await expect(
      ApiRuntimeBootstrap.create({
        source: { API_PORT: "0" },
        composition,
        signals: false,
      }),
    ).rejects.toThrow("Invalid api configuration");

    expect(composition.compose).not.toHaveBeenCalled();
    expect(process.start).not.toHaveBeenCalled();
  });

  /** @scenario "An unreadable switch is refused instead of read as off" */
  it("rejects a feature switch written in a spelling nothing reads, before composing", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);

    await expect(
      ApiRuntimeBootstrap.create({
        source: { NODE_ENV: "test", PORT: "6560", PASSKEYS_ENABLED: "true" },
        composition,
        signals: false,
      }),
    ).rejects.toThrow("Invalid api configuration");

    expect(composition.compose).not.toHaveBeenCalled();
    expect(process.start).not.toHaveBeenCalled();
  });

  /** @scenario "A cross-field rule refuses a half-configured feature at boot" */
  it("rejects a half-configured feature before composing a graph", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);

    await expect(
      ApiRuntimeBootstrap.create({
        source: {
          NODE_ENV: "test",
          PORT: "6560",
          LANGY_AGENT_URL: "http://127.0.0.1:5564",
        },
        composition,
        signals: false,
      }),
    ).rejects.toThrow(/both its address and its shared secret/);

    expect(composition.compose).not.toHaveBeenCalled();
    expect(process.start).not.toHaveBeenCalled();
  });

  /** @scenario "A named but unusable configuration refuses the boot" */
  it("rejects a named but incomplete Lambda fleet before composing a graph", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);

    await expect(
      ApiRuntimeBootstrap.create({
        source: { NODE_ENV: "test", PORT: "6560", LANGWATCH_NLP_LAMBDA_CONFIG: "{" },
        composition,
        signals: false,
      }),
    ).rejects.toThrow("Invalid api configuration");

    expect(composition.compose).not.toHaveBeenCalled();
    expect(process.start).not.toHaveBeenCalled();
  });

  it("retains one composed graph and closes listener, telemetry, then graph resources once", async () => {
    const phases: string[] = [];
    const process = new TestProcess();
    const composition = new TestComposition(process);
    composition.compose.mockImplementationOnce(async ({ graph, resources }) => {
      resources.own("database", async () => {
        phases.push("graph");
      });
      process.close.mockImplementationOnce(async () => {
        phases.push("listener");
        phases.push("telemetry");
        await graph.close();
      });
      return process;
    });
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test", PORT: "6560" },
      composition,
      signals: false,
    });

    await main.start();
    await Promise.all([main.close(), main.close()]);

    expect(composition.compose).toHaveBeenCalledOnce();
    expect(main.config.port).toBe(6560);
    expect(process.start).toHaveBeenCalledOnce();
    expect(process.close).toHaveBeenCalledOnce();
    expect(phases).toEqual(["listener", "telemetry", "graph"]);
  });

  it("shares one close operation across repeated termination signals", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);
    const host = new TestSignalHost();
    const exits: number[] = [];
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test" },
      composition,
      signals: {
        host,
        exit: (code) => {
          exits.push(code);
        },
      },
    });

    host.emit("SIGTERM");
    host.emit("SIGINT");
    await vi.waitFor(() => expect(process.close).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(exits).toEqual([0]));

    await main.close();
    expect(process.close).toHaveBeenCalledOnce();
  });

  it("retains a composition failure when its resource cleanup also fails", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);
    const bootFailure = new Error("composition failed");
    composition.compose.mockImplementationOnce(async ({ resources }) => {
      resources.own("database", async () => {
        throw new Error("database close failed");
      });
      throw bootFailure;
    });

    await expect(
      ApiRuntimeBootstrap.create({
        source: { NODE_ENV: "test" },
        composition,
        signals: false,
      }),
    ).rejects.toBe(bootFailure);
  });

  it("starts feature services before listening and drains them before telemetry and resources", async () => {
    const phases: string[] = [];
    const process = new TestProcess();
    const composition = new TestComposition(process);
    composition.compose.mockImplementationOnce(async ({ graph, resources }) => {
      resources.own("database", () => {
        phases.push("resources");
      });
      resources.ownService({
        name: "broadcast",
        start: () => {
          phases.push("feature:start");
        },
        stop: () => {
          phases.push("feature:stop");
        },
      });
      process.start.mockImplementation(async () => {
        phases.push("listen");
      });
      process.close.mockImplementation(async () => {
        phases.push("listener:close");
        await graph.drain();
        phases.push("telemetry");
        await graph.close();
      });
      return process;
    });
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test" },
      composition,
      signals: false,
    });

    expect(phases).toEqual([]);
    await Promise.all([main.start(), main.start()]);
    await Promise.all([main.close(), main.close()]);

    expect(phases).toEqual([
      "feature:start",
      "listen",
      "listener:close",
      "feature:stop",
      "telemetry",
      "resources",
    ]);
    expect(process.start).toHaveBeenCalledOnce();
    expect(process.close).toHaveBeenCalledOnce();
  });

  it("waits for feature readiness before opening the listener", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);
    let ready: () => void = () => void 0;
    const gate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const starting = vi.fn<() => Promise<void>>(() => gate);
    composition.compose.mockImplementationOnce(async ({ resources }) => {
      resources.ownService({ name: "subscription", start: starting, stop: () => void 0 });
      return process;
    });
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test" },
      composition,
      signals: false,
    });
    const started = main.start();
    await vi.waitFor(() => expect(starting).toHaveBeenCalledOnce());
    expect(process.start).not.toHaveBeenCalled();

    ready();
    await started;
    expect(process.start).toHaveBeenCalledOnce();
    await main.close();
  });

  it.each(["feature", "listener"] as const)("rolls back a failed %s start once", async (phase) => {
    const failure = new Error(`${phase} failed`);
    const process = new TestProcess();
    const composition = new TestComposition(process);
    const release = vi.fn<() => void>();
    const stop = vi.fn<() => void>();
    composition.compose.mockImplementationOnce(async ({ resources }) => {
      resources.own("database", release);
      resources.ownService({
        name: "subscription",
        start: () => {
          if (phase === "feature") throw failure;
        },
        stop,
      });
      if (phase === "listener") process.start.mockRejectedValue(failure);
      return process;
    });
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test" },
      composition,
      signals: false,
    });

    await expect(main.start()).rejects.toBe(failure);
    await main.close();

    expect(stop).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(process.close).toHaveBeenCalledOnce();
    expect(process.start).toHaveBeenCalledTimes(phase === "feature" ? 0 : 1);
  });

  it("closes construction resources without starting or stopping dormant services", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);
    const start = vi.fn<() => void>();
    const stop = vi.fn<() => void>();
    const release = vi.fn<() => void>();
    composition.compose.mockImplementationOnce(async ({ resources }) => {
      resources.own("database", release);
      resources.ownService({ name: "subscription", start, stop });
      return process;
    });
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test" },
      composition,
      signals: false,
    });

    await main.close();
    await expect(main.start()).rejects.toThrow("closed API runtime");

    expect(start).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(process.start).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases resources when feature drain fails", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);
    const release = vi.fn<() => void>();
    composition.compose.mockImplementationOnce(async ({ resources }) => {
      resources.own("database", release);
      resources.ownService({
        name: "subscription",
        start: () => void 0,
        stop: () => {
          throw new Error("drain failed");
        },
      });
      return process;
    });
    const main = await ApiRuntimeBootstrap.create({
      source: { NODE_ENV: "test" },
      composition,
      signals: false,
    });

    await main.start();
    await expect(main.close()).rejects.toBeInstanceOf(AggregateError);
    expect(release).toHaveBeenCalledOnce();
  });
});
