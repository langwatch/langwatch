/**
 * @vitest-environment node
 *
 * Integration tests for FanOutGenerationService.
 *
 * The LLM call is mocked: what matters here is the persistence contract
 * around it (a real Scenario row per variant, the target carried through,
 * the batch only ready once its variants exist), not the model's prose.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({ generateObject: generateObjectMock }));
vi.mock("~/server/modelProviders/utils", () => ({
  getVercelAIModel: vi.fn().mockResolvedValue({ modelId: "gpt-5-mini" }),
}));

import { getTestUser } from "../../../../utils/testUtils";
import { prisma } from "../../../db";
import { getFanOutSetId } from "../../fanout-set-id";
import {
  ADJACENT_SCENARIO_LENSES,
  FanOutGenerationService,
} from "../fan-out-generation.service";

const projectId = "test-project-id";

function variantFixture(lens: string, index: number) {
  return {
    lens,
    name: `Variant ${index}`,
    situation: `Situation for ${lens}`,
    criteria: [
      `First criterion for ${lens}`,
      `Second criterion for ${lens}`,
      `Third criterion for ${lens}`,
    ],
    rationale: `Why ${lens} is a distinct adjacent case`,
  };
}

/** Six variants, one per lens — the default mix. */
function sixVariants() {
  return {
    object: {
      variants: ADJACENT_SCENARIO_LENSES.map((lens, i) =>
        variantFixture(lens, i),
      ),
    },
  };
}

describe("FanOutGenerationService", () => {
  const service = FanOutGenerationService.create(prisma);
  const target = { type: "prompt", referenceId: "prompt_abc123" } as const;

  beforeAll(async () => {
    await getTestUser();
  });

  beforeEach(async () => {
    await prisma.fanOutVariant.deleteMany({ where: { batch: { projectId } } });
    await prisma.fanOutBatch.deleteMany({ where: { projectId } });
    await prisma.scenario.deleteMany({ where: { projectId } });
    generateObjectMock.mockReset();
  });

  describe("given a free-text incident description", () => {
    describe("when generating adjacent scenarios", () => {
      /** @scenario "Free-text generation drafts a seed situation and criteria first" */
      it("drafts a seed situation and criteria before fanning out", async () => {
        generateObjectMock
          .mockResolvedValueOnce({
            object: {
              situation: "Drafted seed situation",
              criteria: ["Drafted criterion"],
            },
          })
          .mockResolvedValueOnce(sixVariants());

        const result = await service.generate({
          projectId,
          createdById: null,
          target,
          seed: {
            type: "FREE_TEXT",
            description: "Agent refuses refunds over $500",
          },
        });

        expect(result.batch.seedDescription).toBe("Drafted seed situation");
        expect(result.batch.seedCriteria).toEqual(["Drafted criterion"]);
        // Two calls: one to draft the seed, one to fan out.
        expect(generateObjectMock).toHaveBeenCalledTimes(2);
      });

      /** @scenario "Generated variants inherit the seed's target" */
      it("records the caller's target on the batch", async () => {
        generateObjectMock
          .mockResolvedValueOnce({
            object: { situation: "s", criteria: ["c"] },
          })
          .mockResolvedValueOnce(sixVariants());

        const result = await service.generate({
          projectId,
          createdById: null,
          target,
          seed: { type: "FREE_TEXT", description: "something broke" },
        });

        expect(result.batch.seedTarget).toEqual(target);
      });
    });
  });

  describe("given a failed scenario run as the seed", () => {
    describe("when generating adjacent scenarios", () => {
      /** @scenario "A run seed reuses its own scenario text" */
      it("reuses the seed scenario's own situation and criteria", async () => {
        const seedScenario = await prisma.scenario.create({
          data: {
            id: "scenario_seed_1",
            projectId,
            name: "Refund flow",
            situation: "Human-authored situation",
            criteria: ["Human-authored criterion"],
            labels: [],
          },
        });
        generateObjectMock.mockResolvedValueOnce(sixVariants());

        const result = await service.generate({
          projectId,
          createdById: null,
          target,
          seed: {
            type: "SCENARIO_RUN",
            scenarioId: seedScenario.id,
            scenarioRunId: "scenariorun_1",
          },
        });

        expect(result.batch.seedDescription).toBe("Human-authored situation");
        expect(result.batch.seedCriteria).toEqual(["Human-authored criterion"]);
        // Only the fan-out call — no LLM round trip to restate text a human wrote.
        expect(generateObjectMock).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given generation succeeds", () => {
    beforeEach(() => {
      generateObjectMock
        .mockResolvedValueOnce({ object: { situation: "s", criteria: ["c"] } })
        .mockResolvedValueOnce(sixVariants());
    });

    /** @scenario "Every generated variant is a real, persisted scenario" */
    it("persists one real scenario row per variant", async () => {
      const result = await service.generate({
        projectId,
        createdById: null,
        target,
        seed: { type: "FREE_TEXT", description: "incident" },
      });

      expect(result.variants).toHaveLength(6);
      for (const variant of result.variants) {
        const scenario = await prisma.scenario.findUnique({
          where: { id: variant.scenarioId },
        });
        // Dispatch hard-requires a persisted Scenario row, so an ephemeral
        // config would never reach the execution pipeline.
        expect(scenario).not.toBeNull();
      }
    });

    /** @scenario "Default generation covers the six adjacency lenses" */
    it("covers the six adjacency lenses", async () => {
      const result = await service.generate({
        projectId,
        createdById: null,
        target,
        seed: { type: "FREE_TEXT", description: "incident" },
      });

      expect(result.variants.map((v) => v.lens).sort()).toEqual(
        [...ADJACENT_SCENARIO_LENSES].sort(),
      );
    });

    /** @scenario "Failing variants stay visible in the scenario library" */
    it("labels each variant scenario so it is filterable in the library", async () => {
      const result = await service.generate({
        projectId,
        createdById: null,
        target,
        seed: { type: "FREE_TEXT", description: "incident" },
      });

      const scenario = await prisma.scenario.findUnique({
        where: { id: result.variants[0]!.scenarioId },
      });
      expect(scenario!.labels).toContain("fan-out");
      expect(scenario!.labels).toContain(`fan-out:${result.variants[0]!.lens}`);
    });

    /** @scenario "Nothing reaches the scenario library unreviewed" */
    it("leaves every variant pending review", async () => {
      const result = await service.generate({
        projectId,
        createdById: null,
        target,
        seed: { type: "FREE_TEXT", description: "incident" },
      });

      expect(result.variants.every((v) => v.status === "PENDING")).toBe(true);
    });

    it("namespaces the batch's scenario set by its own id", async () => {
      const result = await service.generate({
        projectId,
        createdById: null,
        target,
        seed: { type: "FREE_TEXT", description: "incident" },
      });

      expect(result.batch.scenarioSetId).toBe(getFanOutSetId(result.batch.id));
    });

    /** @scenario "Batch moves to ready-for-review once generation completes" */
    it("only reports ready for review once the variants exist", async () => {
      const result = await service.generate({
        projectId,
        createdById: null,
        target,
        seed: { type: "FREE_TEXT", description: "incident" },
      });

      expect(result.batch.status).toBe("READY_FOR_REVIEW");
      const persisted = await prisma.fanOutVariant.count({
        where: { batchId: result.batch.id },
      });
      expect(persisted).toBe(6);
    });
  });

  describe("given the seed scenario does not exist", () => {
    /** @scenario "Show a clear error when the seed scenario is gone" */
    it("fails instead of generating against a missing seed", async () => {
      generateObjectMock.mockResolvedValue(sixVariants());

      await expect(
        service.generate({
          projectId,
          createdById: null,
          target,
          seed: {
            type: "SCENARIO_RUN",
            scenarioId: "scenario_does_not_exist",
            scenarioRunId: "scenariorun_1",
          },
        }),
      ).rejects.toMatchObject({ code: "fan_out_seed_scenario_not_found" });
    });
  });
});
