import { describe, expect, it, vi } from "vitest";
import {
  ApiRuntimeBootstrap,
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../api.main";
import type { ApiShutdownSignal, ApiSignalHost } from "../api.signal-handlers";

class TestProcess extends ApiRuntimeProcessPort {
  readonly start = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
}

class TestComposition extends ApiRuntimeCompositionPort {
  readonly compose = vi.fn(async (_options: ApiRuntimeCompositionOptions) => this.process);

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
});
