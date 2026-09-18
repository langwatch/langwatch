/**
 * The gate: two conditions, and the one that costs nothing is checked first.
 *
 * @see ../access.ts
 * @see specs/analytics/lwql-eval-functions.feature
 */

import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { instantEvalsEnabled } from "../access";
import { isInstantEvalClassifierConfigured } from "../classifier";

/** A Prisma that fails loudly, so a reach for it is a test failure. */
const UNREACHABLE_PRISMA = {
  project: {
    findUnique: () => {
      throw new Error("the gate must not reach the database to answer this");
    },
  },
} as unknown as PrismaClient;

describe("given a deployment with no classifier configured", () => {
  describe("when a project asks whether it may judge", () => {
    /** @scenario "An eval function is refused when the deployment has no classifier" */
    it("answers no without resolving the flag or reading the project", async () => {
      expect(isInstantEvalClassifierConfigured()).toBe(false);

      await expect(
        instantEvalsEnabled({
          prisma: UNREACHABLE_PRISMA,
          projectId: "project-without-a-classifier",
        }),
      ).resolves.toBe(false);
    });
  });
});
