/**
 * The gate: two conditions, and the one that costs nothing is checked first.
 *
 * Both tests state the deployment's configuration rather than reading it, so
 * the answers here do not change with whatever the ambient environment has set
 * `INSTANT_EVAL_CLASSIFIER` to.
 *
 * @see ../access.ts
 * @see specs/lwql/eval-functions.feature
 */

import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { instantEvalsEnabled } from "../access";

/** A Prisma that fails loudly, so a reach for it is observable either way. */
const REACHED = "the gate read the project";
const LOUD_PRISMA = {
  project: {
    findUnique: () => {
      throw new Error(REACHED);
    },
  },
} as unknown as PrismaClient;

describe("given a deployment with no classifier configured", () => {
  describe("when a project asks whether it may judge", () => {
    /** @scenario "An eval function is refused when the deployment has no classifier" */
    it("answers no without resolving the flag or reading the project", async () => {
      await expect(
        instantEvalsEnabled({
          prisma: LOUD_PRISMA,
          projectId: "project-without-a-classifier",
          isClassifierConfigured: () => false,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given a deployment with a classifier configured", () => {
  describe("when a project asks whether it may judge", () => {
    it("goes on to the flag, which needs the project's organization", async () => {
      // The operational condition passing is what lets the product decision be
      // asked at all, and that decision needs the organization the project
      // belongs to. Asserting the read happens is what pins the order: were
      // the two swapped, a deployment with nothing to answer with would still
      // pay for a project read on every query.
      await expect(
        instantEvalsEnabled({
          prisma: LOUD_PRISMA,
          projectId: "project-with-a-classifier",
          isClassifierConfigured: () => true,
        }),
      ).rejects.toThrow(REACHED);
    });
  });
});
