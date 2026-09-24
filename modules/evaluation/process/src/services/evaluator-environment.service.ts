import type { EvaluationServerConfig } from "@langwatch/evaluation-contract";

import type { EvaluationInstallEnvironment } from "../app/evaluation.members.ts";

/** The evaluator variables main read from the environment, from this module's declared config. */
export class EvaluatorEnvironmentService implements EvaluationInstallEnvironment {
  static create(
    config: Pick<
      EvaluationServerConfig,
      "azureContentSafetyEndpoint" | "enablePresidio" | "enableLingua"
    >,
  ): EvaluatorEnvironmentService {
    return new EvaluatorEnvironmentService({
      AZURE_CONTENT_SAFETY_ENDPOINT: config.azureContentSafetyEndpoint,
      LANGWATCH_ENABLE_PRESIDIO: config.enablePresidio,
      LANGWATCH_ENABLE_LINGUA: config.enableLingua,
    });
  }

  private constructor(private readonly values: Readonly<Record<string, string | undefined>>) {}

  read(): Readonly<Record<string, string | undefined>> {
    return this.values;
  }
}
