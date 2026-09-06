/**
 * The parts of a local install a user can decline, and what they cost.
 *
 * Both toggles exist for the same reason: this installer downloads well over
 * four gigabytes on a first run, and two of those pieces are only worth their
 * bytes to some people. Rather than guess, we pick the default that serves the
 * common case and make the other one a single line to flip.
 *
 * Read from the environment rather than a config file so the same variable
 * works in a shell, in `~/.langwatch/.env`, and in a container.
 */

import { readEnvFile } from "../services/env-file.ts";

export type FeatureToggles = {
  /**
   * The Langy assistant. Costs ~45MB (the opencode runtime, fetched once) and
   * nothing at rest: the manager itself already ships inside the mono-binary
   * the gateway downloads regardless. Default ON: it is a headline feature of
   * the product, and the download is small next to the rest of the install.
   */
  isLangyEnabled: boolean;
  /**
   * The PII detection evaluator. Costs ~670MB, a natural-language model
   * larger than the entire rest of the Python environment, and the single
   * biggest item in the install. Default OFF: most first installs never
   * evaluate PII, and the ones that do can say so and wait for it once.
   *
   * LangWatch's own redaction of secrets and simple PII in the ingestion
   * pipeline is unaffected by this; it is not implemented with presidio.
   */
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

/**
 * Resolves a toggle, honouring both the positive name and, for the assistant,
 * nothing else, there is deliberately one name per toggle. An unrecognised
 * value falls back to the default rather than being treated as false, so a
 * typo cannot silently strip a feature someone asked for.
 */
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

/**
 * The toggles as env lines for the app and workers processes, so the product
 * tells the truth about what this install has. Injected into the children's
 * env explicitly rather than trusted to exist in the .env: an install created
 * before a toggle existed has no line for it, and the app's own default for a
 * missing variable is "available" (container installs carry everything and
 * set nothing), which is exactly wrong for an npx install that just skipped
 * the download.
 */
export function featureEnv(features: FeatureToggles): Record<string, string> {
  return {
    [LANGY_ENV_KEY]: String(features.isLangyEnabled),
    [PRESIDIO_ENV_KEY]: String(features.isPresidioEnabled),
    [LINGUA_ENV_KEY]: String(features.isLinguaEnabled),
  };
}

/**
 * The toggles as an install actually experiences them: the persisted .env
 * first, the shell environment on top. Every consumer (predep registry,
 * installer, service composition, venv extras) resolves through here so the
 * precedence order lives in exactly one place.
 */
export function resolveEffectiveFeatures(envFilePath: string): FeatureToggles {
  return resolveFeatures({ ...readEnvFile(envFilePath), ...process.env });
}
