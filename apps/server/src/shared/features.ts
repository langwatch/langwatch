// Optional install parts. Read from environment for shell, .env, container.

import { readEnvFile } from "../services/env-file.ts";

export type FeatureToggles = {
  // Langy assistant: ~45MB runtime (fetched once). Default ON.
  isLangyEnabled: boolean;
  // PII detection evaluator: ~670MB model. Default OFF.
  isPresidioEnabled: boolean;
  /**
   * The language detection evaluator. Costs ~95MB of language models.
   * Default OFF for the same reason as the PII detector: a niche evaluator
   * should not tax every install that never runs it.
   */
  isLinguaEnabled: boolean;
};

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

// Resolve toggles from env; unrecognised values fall back to default.
function toggle({
  env,
  key,
  defaultEnabled,
}: {
  env: Record<string, string | undefined>;
  key: string;
  defaultEnabled: boolean;
}): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return defaultEnabled;
  if (TRUE.has(raw)) return true;
  if (FALSE.has(raw)) return false;
  return defaultEnabled;
}

export const LANGY_ENV_KEY = "LANGWATCH_ENABLE_LANGY";
export const PRESIDIO_ENV_KEY = "LANGWATCH_ENABLE_PRESIDIO";
export const LINGUA_ENV_KEY = "LANGWATCH_ENABLE_LINGUA";

export function resolveFeatures(
  env: Record<string, string | undefined> = process.env,
): FeatureToggles {
  return {
    isLangyEnabled: toggle({ env, key: LANGY_ENV_KEY, defaultEnabled: true }),
    isPresidioEnabled: toggle({ env, key: PRESIDIO_ENV_KEY, defaultEnabled: false }),
    isLinguaEnabled: toggle({ env, key: LINGUA_ENV_KEY, defaultEnabled: false }),
  };
}

// Feature toggles as env lines for app and worker processes.
export function featureEnv(features: FeatureToggles): Record<string, string> {
  return {
    [LANGY_ENV_KEY]: String(features.isLangyEnabled),
    [PRESIDIO_ENV_KEY]: String(features.isPresidioEnabled),
    [LINGUA_ENV_KEY]: String(features.isLinguaEnabled),
  };
}

// Feature toggles as install experiences them: .env first, then shell env.
export function resolveEffectiveFeatures(envFilePath: string): FeatureToggles {
  return resolveFeatures({ ...readEnvFile(envFilePath), ...process.env });
}
