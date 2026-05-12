/**
 * Self-observability for Langy. Per implementation-plan.md § PR-1.3.
 *
 * **Design note (revised from the original plan):** LangWatch already wires
 * a global OTEL pipeline in `src/instrumentation.node.ts` that ships every
 * span to LangWatch whenever `LANGWATCH_API_KEY` is set — the project is
 * identified by the API key. So "dogfood Langy's own traces" reduces to:
 *   1. Set `LANGWATCH_API_KEY` (and `LANGWATCH_ENDPOINT`) in the app's
 *      `.env` to credentials for a dedicated dogfood project.
 *   2. Attach Langy-specific metadata to every `streamText` call so the
 *      dogfood project can filter for `langy.dogfood = "true"` traces.
 *
 * The original plan envisaged separate `LANGY_DOGFOOD_*` env vars and a
 * second exporter, but `setupObservability` does not currently support
 * per-span routing across projects. If/when we want simultaneous
 * customer-facing + dogfood observability from the same process, we'll
 * stand up a custom `SpanProcessor` — that work belongs in a later phase.
 *
 * This module supplies pure helpers that the route consumes:
 *   - `buildLangyTelemetrySettings(input)` — the
 *     `experimental_telemetry` object to hand to `streamText({ ... })`.
 *   - `isLangyDogfoodConfigured(env)` — true when `LANGWATCH_API_KEY` is
 *     set, i.e. when the global OTEL pipeline is actually going to ship
 *     spans somewhere. Tests and diagnostics use this; the route does not
 *     (it always attaches metadata so traces are well-formed even if
 *     observability is off).
 */

export interface LangyTelemetryInput {
  /** Project the *user* is in (the project Langy is helping with). */
  userProjectId: string;
  /** Session-user id, for per-user filtering inside the dogfood project. */
  userId: string;
  /** Conversation id so traces can be grouped by chat. */
  conversationId: string;
  /** Active langy mode at the time of the call (`expert` | `non-expert`). */
  mode?: string;
}

export interface LangyTelemetrySettings {
  isEnabled: true;
  functionId: "langy.chat";
  metadata: {
    "langwatch.project_id": string;
    "langwatch.user_id": string;
    "langy.conversation_id": string;
    "langy.user_project_id": string;
    "langy.mode": string;
    "langy.dogfood": "true";
  };
}

/**
 * True when the global OTEL pipeline is configured to ship to LangWatch
 * (i.e. `LANGWATCH_API_KEY` is set in env). Pure read; safe to call in
 * tests.
 */
export function isLangyDogfoodConfigured(
  env: Partial<Record<string, string | undefined>> = process.env,
): boolean {
  return Boolean(env.LANGWATCH_API_KEY);
}

/**
 * Build the `experimental_telemetry` object to attach to every Langy
 * `streamText({ ... })` call. Always returns enabled telemetry — if the
 * global OTEL pipeline isn't configured the spans are simply dropped, so
 * there's no downside to attaching metadata unconditionally.
 */
export function buildLangyTelemetrySettings(
  input: LangyTelemetryInput,
): LangyTelemetrySettings {
  return {
    isEnabled: true,
    functionId: "langy.chat",
    metadata: {
      "langwatch.project_id": input.userProjectId,
      "langwatch.user_id": input.userId,
      "langy.conversation_id": input.conversationId,
      "langy.user_project_id": input.userProjectId,
      "langy.mode": input.mode ?? "non-expert",
      "langy.dogfood": "true",
    },
  };
}
