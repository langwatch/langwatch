import { describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import { createWorker } from "../createWorker";

describe("createWorker", () => {
  it("passes the captured App to the worker transport once", async () => {
    const app = { close: vi.fn() } as unknown as App;
    const shutdown = vi.fn(async () => undefined);
    const startWorker = vi.fn(async (receivedApp: App) => {
      expect(receivedApp).toBe(app);
      return { shutdown };
    });

    const runtime = await createWorker({
      composeApp: () => app,
      startWorker,
    });

    await runtime.start();
    await runtime.start();
    await runtime.close();

    expect(startWorker).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(app.close).toHaveBeenCalledOnce();
  });
});
