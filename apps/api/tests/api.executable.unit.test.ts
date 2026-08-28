import { describe, expect, it, vi } from "vitest";
import { ApiBootFailurePort, startApiExecutable } from "../src/api.executable";
import {
  ApiRuntimeCompositionPort,
  ApiRuntimeProcessPort,
  type ApiRuntimeCompositionOptions,
} from "../src/api.main";

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

class TestFailures extends ApiBootFailurePort {
  readonly report = vi.fn();
}

describe("startApiExecutable", () => {
  it("starts one API runtime from the injected config source and complete composition", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);

    const runtime = await startApiExecutable({
      source: { NODE_ENV: "test" },
      composition,
      signals: false,
    });

    expect(runtime.process).toBe(process);
    expect(composition.compose).toHaveBeenCalledOnce();
    expect(process.start).toHaveBeenCalledOnce();
  });

  it("closes a runtime after start failure while retaining the start failure", async () => {
    const process = new TestProcess();
    const composition = new TestComposition(process);
    const failures = new TestFailures();
    const startFailure = new Error("API readiness failed");
    const closeFailure = new Error("API cleanup failed");
    process.start.mockRejectedValueOnce(startFailure);
    process.close.mockRejectedValueOnce(closeFailure);

    await expect(
      startApiExecutable({
        source: { NODE_ENV: "test" },
        composition,
        failures,
        signals: false,
      }),
    ).rejects.toBe(startFailure);

    expect(process.close).toHaveBeenCalledOnce();
    expect(failures.report).toHaveBeenNthCalledWith(1, closeFailure);
    expect(failures.report).toHaveBeenNthCalledWith(2, startFailure);
  });
});
