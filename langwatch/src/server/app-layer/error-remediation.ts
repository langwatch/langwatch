import { docsUrl } from "~/utils/docsUrl";

/**
 * Central remediation registry for handled errors — every `tips` / docs link
 * an error class emits lives here, keyed by the error's `code`. Error classes
 * spread `remediation(code)` into their constructor options instead of
 * inlining copy.
 *
 * Why central: one place to audit the agent-facing copy, and `docsPath` is a
 * repo-relative docs path (not a URL) so CI can verify every linked page
 * actually exists under `docs/` (see __tests__/error-remediation.unit.test.ts).
 *
 * Dynamic content (ids, counts, hints) does NOT belong here — classes compose
 * it: `[dynamicTip, ...remediation(code).tips]`.
 */

interface RemediationEntry {
  readonly tips?: readonly string[];
  /** Leading-slashed Mintlify path, e.g. "/platform/data-retention". */
  readonly docsPath?: string;
}

const registry = {
  // ---- request boundary ----
  validation_error: {
    tips: [
      "Read `reasons` — each entry names the offending field in meta.field and what was expected in meta.expected",
      "Fix those fields and send the request again; retrying it unchanged will fail identically",
    ],
  },
  malformed_request: {
    tips: [
      "The body could not be parsed at all — check for truncated JSON, a trailing comma, or a Content-Type that does not match what was sent",
    ],
  },

  // ---- traces ----
  trace_not_found: {
    tips: [
      "Check the trace id — traces are deleted after the retention window",
      "If you just sent this trace, retry in a few seconds — ingestion is asynchronous",
    ],
    docsPath: "/platform/data-retention",
  },
  span_not_found: {
    tips: [
      "Check the span id — spans are deleted with their trace after the retention window",
    ],
    docsPath: "/platform/data-retention",
  },
  query_timeout: {
    tips: [
      "Narrow the time range",
      "Add filters to reduce the amount of data scanned",
    ],
  },
  query_memory_exceeded: {
    tips: [
      "Narrow the time range",
      "Add filters to reduce the amount of data scanned",
      "Request fewer attribute/metadata fields",
    ],
  },
  filter_parse_error: {
    tips: [
      "Check the filter syntax near the indicated position — filters are field:value pairs combined with AND/OR",
    ],
  },
  filter_field_unknown: {
    tips: [
      "Use one of the fields listed in meta.knownFields",
      "Field names are case-sensitive",
    ],
  },
  time_range_too_wide: {
    tips: ["Query in smaller windows and paginate through the results"],
  },
  clickhouse_unavailable: {
    tips: [
      "This is a temporary platform issue — retry in a few seconds",
      "If it persists, check the LangWatch status page or contact support",
    ],
  },

  // ---- api keys ----
  api_key_not_found: {
    tips: [
      "Check the API key id — the key may have been deleted or never created",
      "List the keys on the organization to find the right id",
    ],
    docsPath: "/api-reference/api-keys/overview",
  },
  api_key_not_owned: {
    tips: ["Ask the key's owner or an organization admin to make this change"],
    docsPath: "/api-reference/api-keys/overview",
  },
  api_key_already_revoked: {
    tips: [
      "Revoked keys cannot be reactivated — create a new API key if you need one",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  api_key_permission_denied: {
    tips: [
      "Re-create the API key with the required scope, or ask an admin to raise your role",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  api_key_scope_violation: {
    tips: [
      "A key cannot be granted a scope you do not hold yourself — lower the requested scope or ask an admin to create the key",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  api_key_reserved_name: {
    tips: [
      "This name is reserved for keys LangWatch manages on your behalf — pick a different name",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },

  // ---- evaluations ----
  evaluation_not_found: {
    tips: [
      "Check the evaluation id — it may belong to a different project",
      "If the evaluation was just started, retry in a few seconds — evaluations run asynchronously",
    ],
    docsPath: "/evaluations/overview",
  },
  trace_not_evaluatable: {
    tips: [
      "Check that the trace contains the inputs/outputs the evaluator expects",
      "If the trace was just ingested, retry in a few seconds — ingestion is asynchronous",
    ],
    docsPath: "/evaluations/overview",
  },
  evaluator_config_error: {
    tips: [
      "Fix the evaluator config named in the message — check the evaluator's expected settings schema",
    ],
    docsPath: "/evaluations/evaluators/list",
  },
  evaluator_execution_error: {
    tips: [
      "Retry in a few seconds — the evaluator backend failed to execute this run",
      "If it persists, check the LangWatch status page or contact support",
    ],
  },
  evaluator_input_too_large: {
    tips: [
      "Shorten the input sent to this evaluator — the payload exceeded the evaluator's size limit",
      "Map the evaluator to a specific field rather than the whole trace, so only what it scores is sent",
    ],
    docsPath: "/evaluations/evaluators/list",
  },
  evaluator_missing_field: {
    tips: [
      "Provide the missing field in the request (see meta.field)",
      "Check the evaluator's expected input schema for the fields it requires",
    ],
    docsPath: "/evaluations/evaluators/list",
  },
  evaluator_not_found: {
    tips: ["Check the evaluator type against the list of available evaluators"],
    docsPath: "/evaluations/evaluators/list",
  },

  // ---- langy ----
  langy_conversation_not_found: {
    tips: [
      "Check the conversation id — it may be archived or belong to another project",
      "Start a new conversation to keep going",
    ],
  },
  langy_conversation_not_owned: {
    tips: [
      "Shared conversations can be viewed but only the owner can continue them — start a new conversation instead",
    ],
  },
  langy_model_not_configured: {
    tips: ["Pick a model in the project's model settings, then retry"],
  },
  langy_model_not_allowed: {
    tips: ["Choose one of the models configured for this project and retry"],
  },
  langy_egress_misconfigured: {
    tips: [
      "Ask a workspace admin to review the project's outbound network policy — Langy refuses to run rather than leak",
    ],
  },
  langy_insufficient_scope: {
    tips: ["Ask a workspace admin to grant Langy permissions in this project"],
  },
  langy_turn_in_progress: {
    tips: [
      "Wait for the current response to finish before sending another message",
    ],
  },
  langy_turn_not_stoppable: {
    tips: [
      "Read the conversation to find the turn it currently has in flight, and stop that one",
      "A turn that already finished needs no stopping — its answer is on the conversation",
    ],
  },
  langy_idempotency_mismatch: {
    tips: [
      "The same idempotency key was reused with different content — mint a fresh key for every new send",
    ],
  },
  langy_empty_message: {
    tips: ["Send a message with actual text content"],
  },
  langy_dispatch_rejected: {
    tips: [
      "The agent rejected this turn's request as invalid — it will not be retried; send a new message",
    ],
  },
  langy_agent_unavailable: {
    tips: [
      "Retry in a few seconds — the agent is down, mid-deploy, or restarting",
    ],
  },
  langy_agent_at_capacity: {
    tips: [
      "Too many conversations are running at once — wait a few seconds and retry",
    ],
  },
  langy_agent_session_lost: {
    tips: [
      "The agent dropped this conversation before finishing — resend the message to pick it back up",
    ],
  },
  langy_github_not_connected: {
    tips: [
      "Install the LangWatch GitHub App (Settings → Integrations) to let the agent open pull requests",
    ],
  },
  langy_github_repo_not_accessible: {
    tips: [
      "Grant the LangWatch GitHub App access to that repository (Settings → Integrations → Configure), then retry",
    ],
  },
  langy_worker_spawn_failed: {
    tips: [
      "The agent failed to start for this turn — nothing was lost, retry in a moment",
    ],
  },
  langy_worker_stopped: {
    tips: [
      "The worker died mid-reply and the server already exhausted its recovery — the message is on record, retry manually",
    ],
  },
  langy_agent_errored: {
    tips: [
      "The model call was rejected upstream — check meta/reasons for the provider's typed failure, then retry",
    ],
  },
  langy_turn_timeout: {
    tips: [
      "Retry — or ask for a narrower slice: a shorter time range or a single trace",
    ],
  },
  langy_worker_restarting: {
    tips: ["An update interrupted this reply — resend the message"],
  },
} as const satisfies Record<string, RemediationEntry>;

export type RemediationCode = keyof typeof registry;

/** All registered codes — used by the registry test to catch typos. */
export const REMEDIATION_CODES = Object.keys(registry) as RemediationCode[];

/** Every docsPath in the registry — consumed by the docs-existence CI test. */
export const REMEDIATION_DOC_PATHS: readonly string[] = Object.values(
  registry as Record<string, RemediationEntry>,
)
  .map((entry) => entry.docsPath)
  .filter((p): p is string => p !== undefined);

/**
 * The remediation fields for a handled-error code, ready to spread into a
 * HandledError constructor's options: `{ tips, docsUrl }`, omitting either
 * when the registry has none.
 */
export function remediation(code: RemediationCode): {
  tips?: readonly string[];
  docsUrl?: string;
} {
  const entry = registry[code] as RemediationEntry;
  return {
    ...(entry.tips ? { tips: entry.tips } : {}),
    ...(entry.docsPath ? { docsUrl: docsUrl(entry.docsPath) } : {}),
  };
}
