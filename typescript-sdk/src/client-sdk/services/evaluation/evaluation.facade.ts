/**
 * EvaluationFacade - Entry point for the evaluation API
 *
 * Provides the `init()` method to create evaluation sessions.
 */

import type { LangwatchApiClient } from "@/internal/api/client";
import type { Logger } from "@/logger";
import { Evaluation } from "./evaluation";
import type { EvaluationInitOptions } from "./types";

type EvaluationFacadeConfig = {
  langwatchApiClient: LangwatchApiClient;
  endpoint: string;
  apiKey: string;
  logger: Logger;
};

/**
 * Facade for creating evaluation sessions
 */
export class EvaluationFacade {
  private readonly config: EvaluationFacadeConfig;

  constructor(config: EvaluationFacadeConfig) {
    this.config = config;
  }

  /**
   * Initialize a new evaluation session
   *
   * @param name - Name of the experiment (used as slug)
   * @param options - Optional configuration
   * @returns An initialized Evaluation instance
   *
   * @example
   * ```typescript
   * const evaluation = await langwatch.evaluation.init('my-experiment');
   *
   * await evaluation.run(dataset, async ({ item, index }) => {
   *   const response = await myAgent(item.question);
   *   evaluation.log('accuracy', { index, score: 0.95 });
   * });
   * ```
   */
  async init(name: string, options?: EvaluationInitOptions): Promise<Evaluation> {
    return Evaluation.init(name, {
      apiClient: this.config.langwatchApiClient,
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      logger: this.config.logger,
      ...options,
    });
  }
}
