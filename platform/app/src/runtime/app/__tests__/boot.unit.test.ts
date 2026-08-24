import { describe, expect, it, vi } from "vitest";
import { AppBoot } from "../boot";

describe("AppBoot", () => {
  it("validates, checks, starts and closes one composed app", async () => {
    const phases: string[] = [];
    const appStart = vi.fn(() => phases.push("app.start"));
    const close = vi.fn(() => phases.push("close"));
    const boot = new AppBoot({
      compose: (config) => {
        phases.push(`compose:${config.port}`);
        return {
          // Models startApp's captured AppRuntime handoff: the composed
          // runtime is started by the transport seam exactly once.
          start: () => appStart(),
          close,
        };
      },
      checkReadiness: () => phases.push("ready"),
    });

    const runtime = await boot.boot({ NODE_ENV: "development", PORT: "6560" });
    expect(phases).toEqual(["compose:6560", "ready", "app.start"]);
    expect(appStart).toHaveBeenCalledOnce();
    await runtime.close();
    await runtime.close();
    expect(phases).toEqual(["compose:6560", "ready", "app.start", "close"]);
    expect(close).toHaveBeenCalledOnce();
  });
});
