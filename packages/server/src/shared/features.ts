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

export type FeatureToggles = {
  /**
   * The Langy assistant. Costs ~45MB (the opencode runtime, fetched once) and
   * nothing at rest — the manager itself already ships inside the mono-binary
   * the gateway downloads regardless. Default ON: it is a headline feature of
   * the product, and the download is small next to the rest of the install.
   */
  langy: boolean;
  /**
   * The PII detection evaluator. Costs ~670MB — a natural-language model
   * larger than the entire rest of the Python environment, and the single
   * biggest item in the install. Default OFF: most first installs never
   * evaluate PII, and the ones that do can say so and wait for it once.
   *
   * LangWatch's own redaction of secrets and simple PII in the ingestion
   * pipeline is unaffected by this — it is not implemented with presidio.
   */
  presidio: boolean;
};

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

/**
 * Resolves a toggle, honouring both the positive name and, for the assistant,
 * nothing else — there is deliberately one name per toggle. An unrecognised
 * value falls back to the default rather than being treated as false, so a
 * typo cannot silently strip a feature someone asked for.
 */
function toggle(env: Record<string, string | undefined>, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (TRUE.has(raw)) return true;
  if (FALSE.has(raw)) return false;
  return fallback;
}

export const LANGY_ENV_KEY = "LANGWATCH_ENABLE_LANGY";
export const PRESIDIO_ENV_KEY = "LANGWATCH_ENABLE_PRESIDIO";

export function resolveFeatures(
  env: Record<string, string | undefined> = process.env,
): FeatureToggles {
  return {
    langy: toggle(env, LANGY_ENV_KEY, true),
    presidio: toggle(env, PRESIDIO_ENV_KEY, false),
  };
}
