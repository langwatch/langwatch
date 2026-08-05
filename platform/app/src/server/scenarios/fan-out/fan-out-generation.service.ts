/**
 * Fan-out generation service: turns a real failure (a failed scenario run or a
 * pasted incident description) into a small, bounded batch of LLM-generated
 * "adjacent" variant scenarios.
 *
 * App-layer for v1 — calls the LLM directly via the Vercel AI SDK, the same
 * tool a Scenario SDK implementation would use internally. Not a Scenario SDK
 * export: the SDK is vendored from a separate external repo with its own
 * release cycle, so making generation code-first too is a deliberate,
 * non-blocking fast-follow rather than a v1 dependency.
 *
 * See specs/scenarios/adjacent-scenario-generation.feature.
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type {
  FanOutBatch,
  FanOutSeedType,
  FanOutVariant,
  PrismaClient,
} from "@prisma/client";
import { generateObject } from "ai";
import { z } from "zod";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { KSUID_RESOURCES } from "~/utils/constants";
import { getFanOutSetId } from "../fanout-set-id";
import { ScenarioRepository } from "../scenario.repository";
import { FanOutSeedScenarioNotFoundError } from "./errors";
import { FanOutRepository } from "./fan-out.repository";

/** Generates a fan-out batch id. */
function generateFanOutBatchId(): string {
  return generate(KSUID_RESOURCES.FAN_OUT_BATCH).toString();
}

const logger = createLogger("langwatch:scenarios:fan-out:generation");

const MIN_VARIANTS = 5;
const MAX_VARIANTS = 8;
const DEFAULT_VARIANT_COUNT = 6;

export const ADJACENT_SCENARIO_LENSES = [
  "paraphrase",
  "entity_substitution",
  "tone_shift",
  "adjacent_intent",
  "boundary_value",
  "multi_turn_context_variation",
] as const;

export type AdjacentScenarioLens = (typeof ADJACENT_SCENARIO_LENSES)[number];

const lensEnum = z.enum(ADJACENT_SCENARIO_LENSES);

const variantSchema = z.object({
  lens: lensEnum.describe("Which adjacency lens this variant explores"),
  name: z.string().describe("A short, descriptive name (3-6 words)"),
  situation: z
    .string()
    .describe(
      "The context and setup for this variant: user persona, emotional state, background, and goal",
    ),
  criteria: z
    .array(z.string())
    .describe("3-6 specific, observable success criteria for this variant"),
  rationale: z
    .string()
    .describe(
      "Why this is a meaningful adjacent case distinct from the seed — not a restatement of the seed's situation",
    ),
});

const fanOutGenerationSchema = z.object({
  variants: z.array(variantSchema).min(MIN_VARIANTS).max(MAX_VARIANTS),
});

const SYSTEM_PROMPT = `You are a test-scenario fan-out assistant for LangWatch. Given a seed failure (a situation and the criteria the agent failed to meet), generate a small batch of ADJACENT variant scenarios — cases that are one small step away from the seed, not restatements of it. Each variant must explore exactly one of these lenses:

- paraphrase: the same request, worded differently
- entity_substitution: the same request, with different names/products/amounts
- tone_shift: the same request, from a user in a different emotional state (angry, confused, calm, rushed)
- adjacent_intent: a related but distinct request that would hit the same underlying code path
- boundary_value: a request at the edge of what the criteria describe (limits, thresholds, edge cases)
- multi_turn_context_variation: the same goal, reached via a different conversational path or prior context

For each variant, write a rationale explaining why it is a genuinely different, meaningful test case — not just a cosmetic reword of the seed. Generate between ${MIN_VARIANTS} and ${MAX_VARIANTS} variants, covering as many distinct lenses as possible.`;

const SEED_DRAFT_SYSTEM_PROMPT = `You are a scenario-seed drafting assistant for LangWatch. Given a short incident description, draft the situation and criteria for the underlying test scenario, formatted the same way a human author would: situation includes user persona, emotional state, background, and goal; criteria are 3-6 specific, observable, judgeable success criteria.`;

const seedDraftSchema = z.object({
  situation: z.string(),
  criteria: z.array(z.string()),
});

export type FanOutTarget = {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
};

/**
 * A Scenario row carries no target of its own — the target (prompt / http /
 * code / workflow) is chosen at run time. So every seed type must state which
 * target the generated variants will run against; the caller knows it (the
 * failed run's target, or the one picked in the generate modal) and passes it
 * explicitly rather than this service guessing.
 */
export type GenerateFanOutBatchInput = {
  projectId: string;
  createdById: string | null;
  target: FanOutTarget;
  seed:
    | {
        type: "SCENARIO_RUN";
        scenarioId: string;
        scenarioRunId: string;
      }
    | {
        type: "FREE_TEXT";
        description: string;
      };
  count?: number;
};

export type GenerateFanOutBatchResult = {
  batch: FanOutBatch;
  variants: FanOutVariant[];
};

export class FanOutGenerationService {
  private readonly scenarioRepository: ScenarioRepository;
  private readonly fanOutRepository: FanOutRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.scenarioRepository = new ScenarioRepository(prisma);
    this.fanOutRepository = new FanOutRepository(prisma);
  }

  static create(prisma: PrismaClient): FanOutGenerationService {
    return new FanOutGenerationService(prisma);
  }

  async generate(
    input: GenerateFanOutBatchInput,
  ): Promise<GenerateFanOutBatchResult> {
    const model = await getVercelAIModel({
      projectId: input.projectId,
      featureKey: "scenarios.generator",
    });

    const resolved = await this.resolveSeed(input, model);

    logger.debug(
      { projectId: input.projectId, seedType: input.seed.type },
      "Generating adjacent scenarios",
    );

    const generation = await generateObject({
      model,
      schema: fanOutGenerationSchema,
      system: SYSTEM_PROMPT,
      prompt: `Seed situation:\n${resolved.situation}\n\nSeed criteria:\n${resolved.criteria.map((c) => `- ${c}`).join("\n")}\n\nGenerate ${input.count ?? DEFAULT_VARIANT_COUNT} adjacent variant scenarios.`,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(60_000),
    });

    const seedType = input.seed.type satisfies FanOutSeedType;

    // The batch id is generated up front so scenarioSetId (which namespaces
    // by that id) can be written once, at insert, instead of patched after.
    const batchId = generateFanOutBatchId();
    const scenarioSetId = getFanOutSetId(batchId);

    const batch = await this.fanOutRepository.createBatch({
      id: batchId,
      projectId: input.projectId,
      seedType,
      seedScenarioId:
        input.seed.type === "SCENARIO_RUN" ? input.seed.scenarioId : null,
      seedScenarioRunId:
        input.seed.type === "SCENARIO_RUN" ? input.seed.scenarioRunId : null,
      seedDescription: resolved.situation,
      seedCriteria: resolved.criteria,
      seedTarget: input.target,
      scenarioSetId,
      createdById: input.createdById,
    });

    const seedLabels = [`fan-out:seed-${input.seed.type.toLowerCase()}`];

    const createdScenarios = await Promise.all(
      generation.object.variants.map((variant) =>
        this.scenarioRepository.create({
          projectId: input.projectId,
          name: variant.name,
          situation: variant.situation,
          criteria: variant.criteria,
          labels: [...seedLabels, "fan-out", `fan-out:${variant.lens}`],
          lastUpdatedById: input.createdById,
        }),
      ),
    );

    const variants = await this.fanOutRepository.createVariants(
      generation.object.variants.map((variant, index) => ({
        batchId: batch.id,
        scenarioId: createdScenarios[index]!.id,
        lens: variant.lens,
        rationale: variant.rationale,
      })),
    );

    // Only ready once the variants actually exist, so the batch can never
    // report READY_FOR_REVIEW with nothing to review.
    const readyBatch = await this.fanOutRepository.updateBatchStatus({
      id: batch.id,
      projectId: input.projectId,
      status: "READY_FOR_REVIEW",
    });

    return { batch: readyBatch, variants };
  }

  private async resolveSeed(
    input: GenerateFanOutBatchInput,
    model: Awaited<ReturnType<typeof getVercelAIModel>>,
  ): Promise<{ situation: string; criteria: string[] }> {
    // A failed run's scenario already has a real, human-authored situation and
    // criteria — use them directly rather than paying an LLM call to restate.
    if (input.seed.type === "SCENARIO_RUN") {
      const scenario = await this.scenarioRepository.findByIdIncludingArchived({
        id: input.seed.scenarioId,
        projectId: input.projectId,
      });
      if (!scenario) {
        throw new FanOutSeedScenarioNotFoundError({
          meta: { scenarioId: input.seed.scenarioId },
        });
      }
      return { situation: scenario.situation, criteria: scenario.criteria };
    }

    // A pasted incident is prose, not a scenario, so it gets drafted into one
    // first.
    const draft = await generateObject({
      model,
      schema: seedDraftSchema,
      system: SEED_DRAFT_SYSTEM_PROMPT,
      prompt: input.seed.description,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return draft.object;
  }
}
