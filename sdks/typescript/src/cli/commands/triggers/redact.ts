/**
 * `actionParams` carries the trigger's delivery credentials — Slack webhook URLs,
 * custom-endpoint URLs and their headers — and `/api/v1/triggers` returns them in
 * PLAINTEXT, unredacted.
 */
const REDACTED = "[redacted — fetch from the LangWatch UI]";

/**
 * Constrained to `object`, NOT to a shape declaring `actionParams`.
 */
export const redactTriggerSecrets = <T extends object>(trigger: T): T => {
  const params = (trigger as { actionParams?: unknown }).actionParams;
  if (!params || typeof params !== "object") return trigger;

  return {
    ...trigger,
    actionParams: Object.fromEntries(
      Object.keys(params as Record<string, unknown>).map((key) => [key, REDACTED]),
    ),
  };
};

/** The list form: redacts every element. */
export const redactTriggerListSecrets = <T extends object>(triggers: T[]): T[] =>
  triggers.map(redactTriggerSecrets);
