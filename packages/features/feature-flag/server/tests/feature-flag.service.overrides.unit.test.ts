/**
 * The two levers that sit in front of the operator store — the per-flag
 * environment override and the force-enable list — and what an unregistered
 * key resolves to.
 */
import { resolveFeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryFeatureFlagService } from "../src/testing";

const SYSTEM_FLAG = "ops_es_causality_loop_guard_disabled";
function buildService(source: Readonly<Record<string, unknown>> = {}) {
  return createInMemoryFeatureFlagService({
    config: resolveFeatureFlagConfig(source),
  });
}

describe("FeatureFlagService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the force-enable list", () => {
    it("forces a listed flag on over an operator row that disables it", async () => {
      const { service } = buildService({ FEATURE_FLAG_FORCE_ENABLE: SYSTEM_FLAG });
      await service.setEnabled({
        key: SYSTEM_FLAG,
        enabled: false,
        lastEditedBy: "operator-1",
      });
      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(true);
    });

    it("leaves flags outside the list alone", async () => {
      const { service } = buildService({ FEATURE_FLAG_FORCE_ENABLE: "some_other_flag" });

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(false);
    });

    it("trims whitespace around each entry", async () => {
      const { service } = buildService({
        FEATURE_FLAG_FORCE_ENABLE: `  ${SYSTEM_FLAG} , other  `,
      });

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(true);
    });

    it("loses to a per-flag environment override", async () => {
      const { service } = buildService({
        FEATURE_FLAG_FORCE_ENABLE: SYSTEM_FLAG,
        OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED: "0",
      });

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(false);
    });
  });

  describe("given a per-flag environment override", () => {
    it("returns true for 1 regardless of the caller's default", async () => {
      const { service } = buildService({ OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED: "1" });

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(true);
    });

    it("returns false for 0 regardless of the caller's default", async () => {
      const { service } = buildService({ OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED: "0" });

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(false);
    });

    it("is fixed for the lifetime of the composed service", async () => {
      const source: Record<string, unknown> = {};
      const { service } = buildService(source);

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(false);

      source.OPS_ES_CAUSALITY_LOOP_GUARD_DISABLED = "1";

      await expect(service.isEnabled(SYSTEM_FLAG, { distinctId: "tenant-a" })).resolves.toBe(false);
    });
  });
});
