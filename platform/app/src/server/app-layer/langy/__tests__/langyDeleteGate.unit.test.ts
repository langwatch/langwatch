import { describe, expect, it, vi } from "vitest";
import { FEATURE_FLAGS } from "~/server/featureFlag/registry";
import {
  LANGY_DELETE_GATE_FLAG,
  resolveLangyDeleteGate,
} from "../langyDeleteGate";

const ids = {
  userId: "user_1",
  projectId: "project_1",
  organizationId: "org_1",
};

describe("resolveLangyDeleteGate", () => {
  describe("when the flag is not explicitly configured", () => {
    /** @scenario The flag resolves ON by default and falls back safely on a flag-store error */
    it("resolves ON by default and falls back to ON on a flag-store error", async () => {
      // Default ON is a property of the registry entry, mirroring
      // release_langy_pi_harness.
      const definition = FEATURE_FLAGS.find(
        (flag) => flag.key === LANGY_DELETE_GATE_FLAG,
      );
      expect(definition?.defaultValue).toBe(true);

      // The resolver returns the flag store's answer for the default case…
      const isEnabled = vi.fn().mockResolvedValue(true);
      await expect(
        resolveLangyDeleteGate({ ...ids, flags: { isEnabled } }),
      ).resolves.toBe(true);
      expect(isEnabled).toHaveBeenCalledWith(LANGY_DELETE_GATE_FLAG, {
        distinctId: ids.userId,
        projectId: ids.projectId,
        organizationId: ids.organizationId,
      });

      // …and never throws: a flag-store failure falls back to ON (the
      // fail-safe direction), mirroring LANGY_PI_HARNESS_FLAG's fallback.
      const throwing = vi.fn().mockRejectedValue(new Error("flag store down"));
      await expect(
        resolveLangyDeleteGate({ ...ids, flags: { isEnabled: throwing } }),
      ).resolves.toBe(true);
    });
  });

  describe("when the flag is turned off for the project", () => {
    it("resolves OFF", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);
      await expect(
        resolveLangyDeleteGate({ ...ids, flags: { isEnabled } }),
      ).resolves.toBe(false);
    });
  });
});
