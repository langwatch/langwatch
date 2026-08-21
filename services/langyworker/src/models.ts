/**
 * Turns the manager-written model config into a generated pi `models.json`
 * under the wrapper's private agent dir. Two rules keep secrets off disk:
 * the base URL (a loopback gateway URL, not secret) is resolved from the env
 * at boot and written literally; the API key is written as pi's env REFERENCE
 * syntax (`"$OPENAI_API_KEY"`), resolved by pi at request time.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LangyWorkerModelConfig } from "./config.js";

export const PROVIDER_ID = "langwatch-gateway";

export type GeneratedModels = {
  modelsPath: string;
  providerId: string;
  modelId: string;
};

export function buildModelsJson(
  model: LangyWorkerModelConfig,
  env: Record<string, string | undefined>,
): { providers: Record<string, unknown> } {
  const baseUrl = env[model.baseUrlEnv];
  if (!baseUrl) {
    throw new Error(`model.baseUrlEnv names "${model.baseUrlEnv}" but that variable is not set`);
  }
  if (env[model.apiKeyEnv] === undefined) {
    throw new Error(`model.apiKeyEnv names "${model.apiKeyEnv}" but that variable is not set`);
  }
  const { baseUrlEnv: _baseUrlEnv, apiKeyEnv, ...modelEntry } = model;
  return {
    providers: {
      [PROVIDER_ID]: {
        baseUrl,
        api: model.api,
        apiKey: `$${apiKeyEnv}`,
        models: [modelEntry],
      },
    },
  };
}

export function writeModelsJson(options: {
  agentDir: string;
  model: LangyWorkerModelConfig;
  env: Record<string, string | undefined>;
}): GeneratedModels {
  const { agentDir, model, env } = options;
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const modelsPath = join(agentDir, "models.json");
  writeFileSync(modelsPath, `${JSON.stringify(buildModelsJson(model, env), null, 2)}\n`, {
    mode: 0o600,
  });
  return { modelsPath, providerId: PROVIDER_ID, modelId: model.id };
}
