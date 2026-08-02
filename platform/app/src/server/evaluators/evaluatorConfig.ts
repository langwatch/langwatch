/**
 * Write-side counterpart to `resolveEvaluatorSettings`
 * (`event-sourcing/pipelines/evaluation-processing/commands/executeEvaluation.command.ts`),
 * which is what reads these rows back on the online evaluation path.
 *
 * Both exist because of langwatch#6397: an evaluator can be stored with its
 * settings at the TOP LEVEL of `config` rather than under `config.settings`, and
 * the online path then failed to recover the prompt, forwarded an empty settings
 * object, and let langevals apply its own strict default prompt — scoring every
 * trace 0 while the same prompt passed in the playground.
 *
 * The read side now recovers those rows, which covers evaluators that already
 * exist. This is defence in depth for new writes, and it is applied at every
 * config write site rather than at one chokepoint, because **there is no single
 * chokepoint**: `routers/evaluators.ts` create/update go through
 * `EvaluatorService` → `EvaluatorRepository`, but the copy and replicate flows
 * call `ctx.prisma.evaluator.update` directly and copy `source.config` verbatim,
 * which is how a bad shape propagates across projects.
 */

/**
 * Keys that live in `config` as metadata about the evaluator rather than as
 * input to the judge. Everything else at the top level is settings that were
 * written in the wrong shape.
 */
const CONFIG_METADATA_KEYS = new Set(["evaluatorType", "settings"]);

/**
 * Moves any top-level settings in an evaluator `config` under `config.settings`,
 * so the shape the online path reads is the shape that gets stored.
 *
 * Already-correct configs and configs carrying nothing but metadata are returned
 * unchanged — normalising is not allowed to invent a `settings` key that was not
 * implied by the data, because an empty one would shadow `monitor.parameters`
 * and break the legacy-monitor fallback the online path still depends on.
 *
 * When both a nested `settings` and stray top-level keys are present, the nested
 * object wins for any key it already defines: it is the shape the current UI
 * writes, so it is the more likely to be current.
 */
export function normalizeEvaluatorConfig<T>(config: T): T {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return config;
  }

  const record = config as Record<string, unknown>;

  // `evaluatorType` is the discriminator for "this config holds built-in
  // evaluator settings", and it is the same one `createWithDefaults` gates on.
  // Without it, normalising is actively destructive: a CODE evaluator's config
  // is `{ code, inputs, outputs }` with no evaluatorType and no settings, so
  // treating those as stray keys buries the whole shape under `settings` and
  // the evaluator stops working. Workflow evaluators are likewise
  // `{ workflowId }`-shaped. Leave anything unrecognised exactly as it is.
  if (typeof record.evaluatorType !== "string") {
    return config;
  }
  const strays = Object.entries(record).filter(
    ([key]) => !CONFIG_METADATA_KEYS.has(key),
  );
  if (strays.length === 0) {
    return config;
  }

  const nested =
    record.settings && typeof record.settings === "object"
      ? (record.settings as Record<string, unknown>)
      : {};

  const normalized: Record<string, unknown> = {
    settings: { ...Object.fromEntries(strays), ...nested },
  };
  if ("evaluatorType" in record) {
    normalized.evaluatorType = record.evaluatorType;
  }

  return normalized as T;
}
