import { describe, expect, it, vi } from "vitest";
import type { App } from "~/server/app-layer/app";
import { createApp } from "../createApp";

describe("createApp", () => {
  it("exposes and closes the one composed process App", async () => {
    const app = { close: vi.fn(async () => undefined) } as unknown as App;
    const runtime = await createApp({
      composeApp: () => app,
      features: [],
    });

    expect(runtime.app).toBe(app);

    await runtime.start();
    await runtime.close();
    await runtime.close();

    expect(app.close).toHaveBeenCalledOnce();
  });
});
