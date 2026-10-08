import { describe, expect, it, vi } from "vitest";

// Runs before the import below: the config must win over a value that asks
// for the check.
vi.hoisted(() => {
  process.env.CHECKPOINT_DISABLE = "";
});

import "../../../prisma.config";

describe("the app's Prisma config", () => {
  describe("when CHECKPOINT_DISABLE is empty before the config loads", () => {
    /** @scenario "Prisma's version check is off in every environment" */
    it("sets it so Prisma skips its version check", () => {
      expect(process.env.CHECKPOINT_DISABLE).toBe("1");
    });
  });
});
