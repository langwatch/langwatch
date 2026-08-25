import { describe, expect, it } from "vitest";
import { resolveOpsWorkerConfig } from "../ops-workers.adapter";

describe("resolveOpsWorkerConfig", () => {
  it("uses self-hosted defaults when no worker settings are supplied", () => {
    const config = resolveOpsWorkerConfig({});

    expect(config).toMatchObject({
      disabled: false,
      installMethod: "self-hosted",
      hostname: void 0,
      environment: void 0,
    });
  });

  it("disables telemetry for SaaS and explicit opt-out values", () => {
    expect(resolveOpsWorkerConfig({ IS_SAAS: "true" }).disabled).toBe(true);
    expect(resolveOpsWorkerConfig({ DISABLE_USAGE_STATS: "1" }).disabled).toBe(true);
  });

  it("rejects invalid booleans during worker composition", () => {
    expect(() => resolveOpsWorkerConfig({ IS_SAAS: "sometimes" })).toThrow();
  });
});
