/**
 * Self-observability for Langy. Per implementation-plan.md § PR-1.3.
 *
 * Every Langy LLM call should emit a trace to a dedicated "dogfood"
 * LangWatch project so the team can grade Langy's own behaviour with
 * the same tools we ship to customers. Configuration lives in env:
 *
 *   LANGY_DOGFOOD_PROJECT_ID   — the LangWatch project id traces ship to
 *   LANGY_DOGFOOD_API_KEY      — its api key
 *   LANGY_DOGFOOD_ENABLED      — optional "true"/"false" kill switch;
 *                                defaults to enabled when both values
 *                                above are present.
 *
 * Wiring this into `streamText`'s `experimental_telemetry` option lives
 * in a follow-up PR. This module supplies the pure helpers that the
 * route will consume, plus the metadata schema the dogfood project
 * filters on.
 */

export interface LangyDogfoodConfig {
  projectId: string;
  apiKey: string;
}

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
 * Reads the dogfood project credentials from env, returning null if
 * either is missing or if `LANGY_DOGFOOD_ENABLED` is explicitly "false".
 * Pure read; safe to call in tests.
 */
export function getLangyDogfoodConfig(
  env: NodeJS.ProcessEnv = process.env,
): LangyDogfoodConfig | null {
  const explicit = env.LANGY_DOGFOOD_ENABLED;
  if (explicit === "false") return null;

  const projectId = env.LANGY_DOGFOOD_PROJECT_ID;
  const apiKey = env.LANGY_DOGFOOD_API_KEY;
  if (!projectId || !apiKey) return null;

  return { projectId, apiKey };
}

/**
 * Build the telemetry settings object to attach to `streamText({
 * experimental_telemetry: ... })`. Returns null when the dogfood project
 * is not configured — callers should fall back to the previous inline
 * telemetry config in that case.
 */
export function buildLangyTelemetrySettings(
  input: LangyTelemetryInput,
  env: NodeJS.ProcessEnv = process.env,
): LangyTelemetrySettings | null {
  if (!getLangyDogfoodConfig(env)) return null;

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
