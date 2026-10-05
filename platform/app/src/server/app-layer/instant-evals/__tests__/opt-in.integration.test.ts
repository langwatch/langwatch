/**
 * First click wins, proven against Postgres.
 *
 * The unit test pins the `updateMany` clause the switch sends; it cannot pin
 * that the clause does what it says. Only the database can answer whether a
 * second click leaves the first member's record in place, so that answer is
 * read back from the stored row here.
 *
 * @see ../opt-in.ts
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { enableInstantEvals } from "../opt-in";

describe("given an organization a member has switched Instant Evals on, stored in Postgres", () => {
  const namespace = `instant-evals-opt-in-${nanoid(8)}`;
  const first = {
    userId: `first-${namespace}`,
    at: new Date("2026-09-29T12:00:00Z"),
  };
  const second = {
    userId: `second-${namespace}`,
    at: new Date("2026-09-30T12:00:00Z"),
  };
  /** Cleanup reads this, so a create that throws leaves nothing to dereference. */
  const createdIds: string[] = [];
  let organizationId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Opt-in ${namespace}`, slug: `opt-in-${namespace}` },
    });
    createdIds.push(organization.id);
    organizationId = organization.id;

    await enableInstantEvals({
      prisma,
      organizationId,
      userId: first.userId,
      now: () => first.at,
    });
  });

  afterAll(async () => {
    if (createdIds.length === 0) return;
    await prisma.organization.deleteMany({ where: { id: { in: createdIds } } });
  });

  describe("when another member throws the switch later", () => {
    /** @scenario "A second click against the database keeps the first record" */
    it("keeps the first member's moment and id in the stored row", async () => {
      await enableInstantEvals({
        prisma,
        organizationId,
        userId: second.userId,
        now: () => second.at,
      });

      const stored = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: {
          instantEvalsEnabledAt: true,
          instantEvalsEnabledByUserId: true,
        },
      });
      expect(stored).toEqual({
        instantEvalsEnabledAt: first.at,
        instantEvalsEnabledByUserId: first.userId,
      });
    });
  });
});
