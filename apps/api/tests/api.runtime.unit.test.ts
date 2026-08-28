import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplicationPort,
  ApiLifecyclePort,
  ApiRuntime,
  type ApiShutdownOptions,
} from "../src/api.runtime";

class TestApplication extends ApiApplicationPort<{ name: string }> {
  readonly application = { name: "langwatch" };
  readonly compose = vi.fn(async () => undefined);
  readonly start = vi.fn(async () => undefined);
  readonly close = vi.fn(async (_options?: ApiShutdownOptions) => undefined);
}

class TestLifecycle extends ApiLifecyclePort<{ composed: true }> {
  readonly compose = vi.fn(async (_resources: ResourceScope) => ({ composed: true }) as const);
}

describe("ApiRuntime", () => {
  it("composes one application and starts and closes it once", async () => {
    const phases: string[] = [];
    const application = new TestApplication();
    const lifecycle = new TestLifecycle();
    application.compose.mockImplementation(async () => {
      phases.push("application");
    });
    lifecycle.compose.mockImplementation(async () => {
      phases.push("features");
      return { composed: true } as const;
    });
    const runtime = await ApiRuntime.create({ application, lifecycle });

    expect(runtime.app).toEqual({ name: "langwatch" });
    expect(runtime.services).toEqual({ composed: true });
    expect(phases).toEqual(["features", "application"]);
    expect(lifecycle.compose).toHaveBeenCalledOnce();
    expect(application.compose).toHaveBeenCalledOnce();

    await Promise.all([runtime.start(), runtime.start()]);
    await Promise.all([
      runtime.close({ terminating: true }),
      runtime.close({ terminating: false }),
    ]);

    expect(application.start).toHaveBeenCalledOnce();
    expect(application.close).toHaveBeenCalledOnce();
    expect(application.close).toHaveBeenCalledWith({ terminating: true });
  });

  it("waits for an in-flight start before closing its owned resources", async () => {
    let releaseStart: (() => void) | undefined;
    const application = new TestApplication();
    application.start.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseStart = () => resolve(undefined);
        }),
    );
    const lifecycle = new TestLifecycle();
    const resources = new ResourceScope();
    const closeResource = vi.fn(async () => undefined);
    resources.own("test", closeResource);
    const runtime = await ApiRuntime.create({ application, lifecycle, resources });

    const start = runtime.start();
    const close = runtime.close();
    releaseStart?.();
    await Promise.all([start, close]);

    expect(application.close).toHaveBeenCalledOnce();
    expect(closeResource).toHaveBeenCalledOnce();
    expect(() => runtime.start()).toThrow("API runtime is closed.");
  });

  it("allows a failed start to be retried", async () => {
    const application = new TestApplication();
    application.start.mockRejectedValueOnce(new Error("not ready"));
    const runtime = await ApiRuntime.create({
      application,
      lifecycle: new TestLifecycle(),
    });

    await expect(runtime.start()).rejects.toThrow("not ready");
    await runtime.start();

    expect(application.start).toHaveBeenCalledTimes(2);
    await runtime.close();
  });

  it("closes owned resources when composition fails", async () => {
    const resources = new ResourceScope();
    const closeResource = vi.fn(async () => undefined);
    resources.own("test", closeResource);
    const lifecycle = new TestLifecycle();
    lifecycle.compose.mockRejectedValueOnce(new Error("composition failed"));

    await expect(
      ApiRuntime.create({
        application: new TestApplication(),
        lifecycle,
        resources,
      }),
    ).rejects.toThrow("composition failed");

    expect(closeResource).toHaveBeenCalledOnce();
  });
});
