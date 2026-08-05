import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:billing:best-effort");

/**
 * Runs a side effect that must never fail its caller.
 *
 * Stripe retries any webhook we answer with a 5xx, so a Slack notification or
 * an analytics capture that throws does not just lose a message: it replays the
 * whole handler, and handlers that write before they notify are not idempotent
 * end to end. The rule "a notification failure must never fail the webhook"
 * was previously kept by remembering to wrap each call in try/catch, and it was
 * kept in three places out of five.
 *
 * `label` is what identifies the failure in the log, so name the side effect
 * rather than the handler: several handlers send the same notification, and the
 * handler is already in the surrounding context.
 *
 * This is for effects nobody downstream reads. Anything a caller branches on
 * must not go through here, because a swallowed failure is indistinguishable
 * from a success.
 */
export async function bestEffort({
  label,
  context,
  run,
}: {
  label: string;
  context?: Record<string, unknown>;
  run: () => Promise<void> | void;
}): Promise<void> {
  try {
    await run();
  } catch (err) {
    try {
      logger.error({ ...context, err }, `[bestEffort] ${label} failed`);
    } catch {
      // The contract is unconditional, so the reporting of a failure cannot be
      // allowed to become one. Spreading `context` and serialising `err` both
      // run arbitrary getters, and a transport can be closed under us; any of
      // those throwing here would fail the webhook for the sake of a log line
      // and hand Stripe a 5xx that replays the whole handler.
    }
  }
}
