/**
 * `actionParams` carries the trigger's delivery credentials — Slack webhook
 * URLs, custom-endpoint URLs and their headers — and `/api/triggers` returns
 * them in PLAINTEXT, unredacted. The human "Trigger Details" block has always
 * deliberately omitted them.
 *
 * That was survivable while the raw payload needed an explicit `-f json`. It is
 * not survivable now: agent mode auto-activates from `CLAUDECODE` and friends,
 * so a bare `lw trigger get <id>` inside any Claude Code session would print a
 * live webhook URL straight into the transcript. Machine output is the MORE
 * exposed surface — it gets logged, piped and pasted into agent context — so it
 * cannot be the one place a secret appears.
 *
 * Key names are kept: an agent needs to know a trigger HAS a `slackWebhook`
 * configured to reason about it; it never needs the value. Fetch the real thing
 * from the platform UI.
 */
const REDACTED = "[redacted — fetch from the LangWatch UI]";

/**
 * Constrained to `object`, NOT to a shape declaring `actionParams`.
 *
 * `triggers/list.ts` and `create.ts` cast the response to types that omit
 * `actionParams` — but the cast is compile-time only, the REST payload really
 * does carry the field, and `JSON.stringify` really does emit it. Requiring the
 * field in the type would make those two call sites un-typeable and leave the
 * secret in the payload, which is the bug this module exists to fix. So the
 * check is a runtime one, deliberately.
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
