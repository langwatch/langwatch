/**
 * @vitest-environment node
 *
 * Integration tests for the fan-out review queue against a real database.
 *
 * FanOutVariant has no projectId of its own, so tenant isolation here is a
 * property of the queries rather than of the multitenancy middleware. That
 * makes it worth proving against the database rather than a mock.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import { getFanOutSetId } from "~/server/scenarios/fanout-set-id";
import { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestProject } from "~/utils/testUtils";
import { FanOutReviewService } from "../fan-out-review.service";

let projectId: string;
let otherProjectId: string;

/**
 * Both ids, for teardown. Filtering on a `let` that setup never assigned is
 * how a teardown becomes an unfiltered sweep, so this is routed through
 * cleanupTestRows, which refuses an entry it cannot fully identify (#6219).
 */
function projectIds(): string[] {
  return [projectId, otherProjectId].filter(Boolean);
}

function service() {
  return FanOutReviewService.create({
    fanOutRepository: new FanOutRepository(prisma),
    scenarioRepository: new ScenarioRepository(prisma),
  });
}

async function seedBatch({
  batchId,
  ownerProjectId,
}: {
  batchId: string;
  ownerProjectId: string;
}) {
  const scenarios = await Promise.all(
    ["a", "b"].map((suffix, index) =>
      prisma.scenario.create({
        data: {
          id: `${batchId}_scenario_${suffix}`,
          projectId: ownerProjectId,
          name: `Variant ${index}`,
          situation: `A situation for variant ${index}`,
          criteria: [`Criterion ${index}a`, `Criterion ${index}b`],
          labels: ["fan-out"],
        },
      }),
    ),
  );

  const batch = await prisma.fanOutBatch.create({
    data: {
      id: batchId,
      projectId: ownerProjectId,
      seedType: "FREE_TEXT",
      seedDescription: "Agent refuses refunds over $500",
      seedCriteria: ["Processes eligible refunds"],
      seedTarget: { type: "prompt", referenceId: "prompt_abc" },
      scenarioSetId: getFanOutSetId(batchId),
      status: "READY_FOR_REVIEW",
    },
  });

  const variants = await Promise.all(
    scenarios.map((scenario, index) =>
      prisma.fanOutVariant.create({
        data: {
          id: `${batchId}_variant_${index}`,
          batchId: batch.id,
          scenarioId: scenario.id,
          lens: index === 0 ? "paraphrase" : "boundary_value",
          rationale: `Why variant ${index} is a distinct adjacent case`,
        },
      }),
    ),
  );

  return { batch, variants, scenarios };
}

describe("FanOutReviewService", () => {
  beforeAll(async () => {
    projectId = (await getTestProject("fan-out-review")).id;
    otherProjectId = (await getTestProject("fan-out-review-other")).id;
  });

  beforeEach(async () => {
    await cleanupTestRows(prisma, [
      ["fanOutVariant", { batch: { projectId: { in: projectIds() } } }],
      ["fanOutBatch", { projectId: { in: projectIds() } }],
      ["scenario", { projectId: { in: projectIds() } }],
    ]);
  });

  describe("given a batch pending review", () => {
    describe("when the reviewer opens it", () => {
      /** @scenario "Open the review drawer for a batch" */
      it("shows each variant's lens, name, situation, criteria and rationale", async () => {
        const { batch } = await seedBatch({
          batchId: "fanoutbatch_review_1",
          ownerProjectId: projectId,
        });

        const reviewable = await service().getBatchForReview({
          projectId,
          batchId: batch.id,
        });

        expect(reviewable.variants).toHaveLength(2);
        for (const variant of reviewable.variants) {
          expect(variant.lens).toBeTruthy();
          expect(variant.rationale).toBeTruthy();
          // The reviewer is approving the scenario, so the scenario has to be
          // in front of them, not just its lens label.
          expect(variant.scenario?.name).toBeTruthy();
          expect(variant.scenario?.situation).toBeTruthy();
          expect(variant.scenario?.criteria.length).toBeGreaterThan(0);
        }
      });

      /** @scenario "Batch moves to ready-for-review once generation completes" */
      it("marks every variant pending", async () => {
        const { batch } = await seedBatch({
          batchId: "fanoutbatch_review_2",
          ownerProjectId: projectId,
        });

        const reviewable = await service().getBatchForReview({
          projectId,
          batchId: batch.id,
        });

        expect(reviewable.variants.every((v) => v.status === "PENDING")).toBe(
          true,
        );
      });
    });
  });

  describe("given a decision is applied", () => {
    /** @scenario "Approve or reject a single variant from its row menu" */
    it("approves only the named variant", async () => {
      const { batch, variants } = await seedBatch({
        batchId: "fanoutbatch_decide_1",
        ownerProjectId: projectId,
      });

      await service().decide({
        projectId,
        batchId: batch.id,
        decisions: [{ variantId: variants[0]!.id, decision: "approve" }],
        decidedById: null,
      });

      const after = await prisma.fanOutVariant.findMany({
        where: { batchId: batch.id },
        orderBy: { id: "asc" },
      });
      expect(after[0]!.status).toBe("APPROVED");
      expect(after[1]!.status).toBe("PENDING");
    });

    /** @scenario "Rejecting a variant archives its scenario" */
    it("archives the scenario behind a rejected variant", async () => {
      const { batch, variants, scenarios } = await seedBatch({
        batchId: "fanoutbatch_decide_2",
        ownerProjectId: projectId,
      });

      await service().decide({
        projectId,
        batchId: batch.id,
        decisions: [{ variantId: variants[0]!.id, decision: "reject" }],
        decidedById: null,
      });

      const rejected = await prisma.scenario.findUnique({
        where: { id: scenarios[0]!.id },
      });
      const untouched = await prisma.scenario.findUnique({
        where: { id: scenarios[1]!.id },
      });
      expect(rejected!.archivedAt).not.toBeNull();
      expect(untouched!.archivedAt).toBeNull();
    });
  });

  describe("given a batch that belongs to another project", () => {
    /** @scenario "Deciding on another project's batch changes nothing" */
    it("refuses the decision and leaves every row untouched", async () => {
      const { batch, variants } = await seedBatch({
        batchId: "fanoutbatch_other_tenant",
        ownerProjectId: otherProjectId,
      });

      await expect(
        service().decide({
          projectId,
          batchId: batch.id,
          decisions: variants.map((variant) => ({
            variantId: variant.id,
            decision: "approve" as const,
          })),
          decidedById: null,
        }),
      ).rejects.toMatchObject({ code: "fan_out_batch_not_found" });

      const after = await prisma.fanOutVariant.findMany({
        where: { batchId: batch.id },
      });
      expect(after.every((variant) => variant.status === "PENDING")).toBe(true);
      expect(after.every((variant) => variant.decidedAt === null)).toBe(true);
    });

    /** @scenario "Deciding on a variant outside the batch changes nothing" */
    it("refuses a variant borrowed from another project's batch", async () => {
      const mine = await seedBatch({
        batchId: "fanoutbatch_mine",
        ownerProjectId: projectId,
      });
      const theirs = await seedBatch({
        batchId: "fanoutbatch_theirs",
        ownerProjectId: otherProjectId,
      });

      await expect(
        service().decide({
          projectId,
          batchId: mine.batch.id,
          decisions: [
            { variantId: mine.variants[0]!.id, decision: "approve" },
            { variantId: theirs.variants[0]!.id, decision: "approve" },
          ],
          decidedById: null,
        }),
      ).rejects.toMatchObject({ code: "fan_out_variant_not_in_batch" });

      // The whole set is refused, so the variant that WAS in the batch must
      // not have been flipped on the way to discovering the one that was not.
      const untouched = await prisma.fanOutVariant.findMany({
        where: { batchId: { in: [mine.batch.id, theirs.batch.id] } },
      });
      expect(untouched.every((variant) => variant.status === "PENDING")).toBe(
        true,
      );
    });
  });

  describe("given a decision names the same variant twice", () => {
    it("refuses rather than letting the last one silently win", async () => {
      const { batch, variants } = await seedBatch({
        batchId: "fanoutbatch_duplicate_decision",
        ownerProjectId: projectId,
      });

      await expect(
        service().decide({
          projectId,
          batchId: batch.id,
          decisions: [
            { variantId: variants[0]!.id, decision: "approve" },
            { variantId: variants[0]!.id, decision: "reject" },
          ],
          decidedById: null,
        }),
      ).rejects.toMatchObject({ code: "fan_out_variant_not_in_batch" });

      const after = await prisma.fanOutVariant.findMany({
        where: { batchId: batch.id },
      });
      expect(after.every((variant) => variant.status === "PENDING")).toBe(true);
    });
  });

  describe("given a decision names a variant that does not exist", () => {
    it("refuses the whole set rather than applying part of it", async () => {
      const { batch, variants } = await seedBatch({
        batchId: "fanoutbatch_unknown_variant",
        ownerProjectId: projectId,
      });

      await expect(
        service().decide({
          projectId,
          batchId: batch.id,
          decisions: [
            { variantId: variants[0]!.id, decision: "approve" },
            { variantId: "fanoutvariant_does_not_exist", decision: "approve" },
          ],
          decidedById: null,
        }),
      ).rejects.toMatchObject({ code: "fan_out_variant_not_in_batch" });

      const after = await prisma.fanOutVariant.findMany({
        where: { batchId: batch.id },
      });
      expect(after.every((variant) => variant.status === "PENDING")).toBe(true);
    });
  });
});
