/**
 * @see specs/upgrade/stepping.feature
 */
import { access } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { defaultPrisma } from "../prisma-tool.ts";

describe("defaultPrisma", () => {
  describe("when asked twice", () => {
    /** @scenario "The Prisma CLI is resolved once per process" */
    it("resolves the prisma CLI once and returns the same tool", async () => {
      const first = defaultPrisma();
      expect(first.command).toBe(process.execPath);
      await expect(access(first.args[0] ?? "")).resolves.toBeUndefined();
      expect(defaultPrisma()).toBe(first);
    });
  });
});
