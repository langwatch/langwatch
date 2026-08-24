import { describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import { createWorker } from "../createWorker";

describe("createWorker", () => {
  it("passes the captured App to the worker transport once", async () => {
    const legacy = { close: vi.fn() } as unknown as App;
    const shutdown = vi.fn(async () => undefined);
    const startLegacy = vi.fn(async (app: App) => {
      expect(app).toBe(legacy);
      return { shutdown };
    });

    const runtime = await createWorker({
      initializeLegacy: () => legacy,
      startLegacy,
    });

    await runtime.start();
    await runtime.start();
    await runtime.close();

    expect(startLegacy).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(legacy.close).toHaveBeenCalledOnce();
  });
});
