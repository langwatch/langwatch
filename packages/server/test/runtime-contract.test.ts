import { describe, expect, it } from "vitest";
import { placeholderRuntime } from "../src/shared/runtime-placeholder.ts";
import type { RuntimeApi, RuntimeContext } from "../src/shared/runtime-contract.ts";
import { allocatePorts } from "../src/shared/ports.ts";
import { paths } from "../src/shared/paths.ts";

const ctx: RuntimeContext = {
  ports: allocatePorts(5560),
  paths,
  predeps: {},
  envFile: paths.envFile,
  version: "3.1.0",
  bullboard: false,
};

describe("placeholder runtime", () => {
  describe("when scaffoldEnv is called before julia ships services/runtime.ts", () => {
    it("throws a clear hand-off error pointing at the channel", async () => {
      await expect(placeholderRuntime.scaffoldEnv(ctx)).rejects.toThrow(/services\/runtime\.ts not yet implemented/);
      await expect(placeholderRuntime.scaffoldEnv(ctx)).rejects.toThrow(/scaffoldEnv/);
      await expect(placeholderRuntime.scaffoldEnv(ctx)).rejects.toThrow(/#langwatch-npx/);
    });
  });

  describe("when stopAll is called against the placeholder", () => {
    it("returns cleanly so SIGINT during a partial bootstrap doesn't double-fail", async () => {
      await expect(placeholderRuntime.stopAll([])).resolves.toBeUndefined();
    });
  });

  describe("events()", () => {
    it("yields nothing by default — the placeholder has no children to supervise", async () => {
      const seen: unknown[] = [];
      for await (const ev of placeholderRuntime.events(ctx)) seen.push(ev);
      expect(seen).toEqual([]);
    });
  });

  describe("RuntimeApi shape (compile-time guard)", () => {
    it("requires every method julia has to implement", () => {
      const api: RuntimeApi = placeholderRuntime;
      expect(typeof api.scaffoldEnv).toBe("function");
      expect(typeof api.installServices).toBe("function");
      expect(typeof api.startAll).toBe("function");
      expect(typeof api.waitForHealth).toBe("function");
      expect(typeof api.stopAll).toBe("function");
      expect(typeof api.events).toBe("function");
    });
  });
});
