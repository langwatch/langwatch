import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type {
  ScenarioGenerateResponse,
  scenarioGenerateRequestSchema,
} from "@langwatch/scenario-contract";
import {
  scenarioGenerateResultSchema,
  ScenarioGenerationFailedError,
  ScenarioGenerationTimedOutError,
} from "@langwatch/scenario-contract";
import type { z } from "zod";

import {
  isAbortLikeError,
  extractNlpgoHandledError,
} from "../rules/scenario-generate-nlpgo-error.rules.ts";
import type { ScenarioGenerateBoundsService } from "./scenario-generate-bounds.service.ts";

export interface ScenarioGenerationDependencies {
  bounds: ScenarioGenerateBoundsService;
  modelProviders: ModelProviderApi;
}

export const SCENARIO_GENERATE_FEATURE_KEY = "scenarios.generator";
export const SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS = 30_000;
const SCENARIO_GENERATE_MAX_RETRIES = 1;
const logger = createLogger("langwatch:scenario:generation");

const SYSTEM_PROMPT = `You are a scenario generation assistant for LangWatch. Your job is to help users create behavioral test scenarios for their AI agents. You will respond with a JSON object containing the scenario details.

Given a description of an agent and desired scenario, generate:

1. **name**: A clear, concise name (3-6 words, e.g., "Angry refund request")

2. **situation**: A detailed context formatted with clear sections separated by blank lines:
   - User persona (who they are)
   - Emotional state (frustrated, confused, rushed, etc.)
   - Background context (what happened before)
   - What they're trying to accomplish

   Format the situation with labeled sections on separate lines, like:
   "User persona: [description]

   Emotional state: [description]

   Background: [description]

   Goal: [description]"

3. **criteria**: 3-6 success criteria that:
   - Are observable from the conversation
   - Test one specific behavior each
   - Use clear, judgeable language (e.g., "Agent must acknowledge the error" not "Agent is helpful")

When refining an existing scenario, incorporate the user's feedback while preserving the overall structure and any parts they haven't asked to change.`;

export class ScenarioGenerationService {
  readonly #dependencies: ScenarioGenerationDependencies;

  private constructor(dependencies: ScenarioGenerationDependencies) {
    this.#dependencies = dependencies;
  }

  static create(dependencies: ScenarioGenerationDependencies): ScenarioGenerationService {
    return new ScenarioGenerationService(dependencies);
  }

  async generate(
    input: z.infer<typeof scenarioGenerateRequestSchema>,
  ): Promise<ScenarioGenerateResponse> {
    const { projectId, prompt, currentScenario } = input;
    await this.#dependencies.bounds.assertGenerateWithinBounds({ projectId });

    try {
      const userPrompt = currentScenario
        ? `Current scenario:\n${JSON.stringify(currentScenario, null, 2)}\n\nUser request: ${prompt}`
        : prompt;
      const generated = await this.#dependencies.modelProviders.generateStructured({
        projectId,
        featureKey: SCENARIO_GENERATE_FEATURE_KEY,
        schema: scenarioGenerateResultSchema,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        maxRetries: SCENARIO_GENERATE_MAX_RETRIES,
        timeoutMs: SCENARIO_GENERATE_DEFAULT_TIMEOUT_MS,
      });

      return { scenario: scenarioGenerateResultSchema.parse(generated) };
    } catch (error) {
      const handled = extractNlpgoHandledError(error);
      if (handled) throw handled;
      if (isAbortLikeError(error)) throw new ScenarioGenerationTimedOutError();

      logger.error({ error }, "Error generating scenario");
      throw new ScenarioGenerationFailedError(error);
    }
  }
}
