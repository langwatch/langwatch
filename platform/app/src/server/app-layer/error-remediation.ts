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
  query_scan_limit_exceeded: {
    tips: [
      "Narrow the time range so fewer partitions are read",
      "Add filters to reduce the amount of data scanned",
      "Aggregate in the query rather than reading raw rows",
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
  lwql_unparseable: {
    tips: [
      "Read `meta.violations` — each entry carries the line and column the parser stopped at",
      "The endpoint accepts native ClickHouse SQL; check for an unclosed quote, bracket, or parenthesis first",
    ],
  },
  lwql_not_permitted: {
    tips: [
      "Read `meta.violations` — each entry names the rule (`code`) and the clause (`clause`) that was refused",
      "Submit one read-only SELECT; writes, DDL, SETTINGS, FORMAT, INTO OUTFILE and table functions are all refused",
      "Read only the datasets the schema endpoint lists for this key, and select fields by name rather than with `*`",
    ],
  },
  lwql_parameter_missing: {
    tips: [
      "Read `meta.parameters` — it lists every parameter the SQL declares that the request left unset",
      "Send a value for each under `parameters`, keyed by the name inside the braces: `{since:DateTime}` reads `parameters.since`",
      "`period_start` and `period_end` are the exception — send them as `timeWindow: { start, end }`, never under `parameters`",
    ],
  },
  lwql_reserved_parameter_supplied: {
    tips: [
      "Read `meta.parameters` — it lists the reserved names the request set for itself",
      "`period_start` and `period_end` are supplied by the surface showing the chart; send `timeWindow: { start, end }` instead and drop them from `parameters`",
    ],
  },
  lwql_reserved_parameter_type: {
    tips: [
      "Read `meta.parameters` — it lists the reserved names declared with the wrong type",
      "Declare each as `DateTime` or `DateTime64`, for example `{period_start:DateTime}`; the interval they describe is half-open, `>= {period_start:DateTime} AND < {period_end:DateTime}`",
    ],
  },
  lwql_not_enabled: {
    tips: [
      "The LangWatchQL feature is not enabled for this project — retrying will not help",
      "Ask an administrator to enable the SQL workbench for this project",
    ],
  },
  saved_workbench_chart_already_exists: {
    tips: [
      "A saved chart with this id already exists in this project",
      "Retry with a different id, or omit the id to have the server mint one",
    ],
  },
  saved_workbench_chart_not_found: {
    tips: [
      "Check the chart id — a chart saved in another project is not readable from this one",
      "List the project's saved charts to see which ids exist",
    ],
  },
  saved_workbench_chart_specification_refused: {
    tips: [
      "Read `meta.errors` — each entry names the rule (`rule`) and the JSON path (`path`) that was refused",
      "A specification may only read the datasets the workbench registers, and may not load anything over the network",
      "The same specification is refused when rendering, so saving it unchanged will not help",
    ],
  },
  saved_workbench_chart_definition_invalid: {
    tips: [
      "This is a defect on our side — the stored chart cannot be read back and retrying will not help",
      "Save the chart again from the workbench to replace the unreadable definition",
    ],
  },
  lwql_unavailable: {
    tips: [
      "The LangWatchQL analytics SQL API is not provisioned on this deployment — retrying will not help",
      "Contact support to have it enabled for this workspace",
    ],
  },
  page_too_deep: {
    tips: [
      "Narrow the time range or filters so the page falls inside the window",
      "Walk forward page by page, which has no depth limit",
    ],
  },
  clickhouse_unavailable: {
    tips: [
      "This is a temporary platform issue — retry in a few seconds",
      "If it persists, check the LangWatch status page or contact support",
    ],
  },
  clickhouse_overloaded: {
    tips: [
      "Too many queries were running at once — retry in a few seconds",
      "Narrow the time range or add filters so the query costs less to run",
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
  api_key_permission_not_delegable: {
    tips: [
      "A wider key or a higher role does not change this — make the change in LangWatch instead",
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

  // ---- management API (organization, members, roles, role bindings) ----
  enterprise_plan_required: {
    tips: [
      "This part of the API is available on the Enterprise plan; meta.feature names which capability was refused",
      "Talk to your account team or visit the pricing page to upgrade the organization's plan",
    ],
    docsPath: "/pricing",
  },
  insufficient_permissions: {
    tips: [
      "The credential lacks the permission named in meta.required_permission",
      "Ask an organization admin to grant that permission, or use an API key whose bindings include it",
    ],
    docsPath: "/platform/rbac",
  },
  role_binding_already_exists: {
    tips: [
      "An identical binding (same principal, role, and scope) already exists; treat this as already done",
      "List the role bindings to find the existing one if you need its id",
    ],
    docsPath: "/platform/rbac",
  },
  custom_role_in_use: {
    tips: [
      "Remove or reassign the role's assignments and bindings first; meta carries how many are holding it",
    ],
    docsPath: "/platform/rbac",
  },
  custom_role_name_taken: {
    tips: [
      "Role names are unique per organization; pick a different name, or update the existing role instead",
    ],
    docsPath: "/platform/rbac",
  },
  organization_slug_taken: {
    tips: [
      "Organization slugs are unique across the instance; pick a different slug, or omit it to derive one from the name",
    ],
  },
  duplicate_invite: {
    tips: [
      "A pending invite for this email already exists; revoke it first, or treat this as already done",
    ],
  },
  scim_token_not_found: {
    tips: [
      "Check the token id; the token may already be revoked",
      "List the organization's SCIM tokens to find the right id",
    ],
    docsPath: "/platform/scim",
  },

  // ---- personal workspace reads ----
  // Both are hit almost entirely by agents and CLIs, which have no UI to fall
  // back on, so the tips have to name the key to swap in rather than restate
  // the refusal.
  personal_project_key_required: {
    tips: [
      "Send the API key from your own personal workspace; a shared or team workspace key names no single owner to report for",
      "Every personal workspace carries its own API key on its settings page",
    ],
  },
  personal_usage_key_mismatch: {
    tips: [
      "Send a key scoped to your own personal workspace; being allowed to view a workspace is not the same as it being yours",
    ],
  },

  // ---- agent dev tunnel ----
  agent_dev_tunnel_unreachable: {
    tips: [
      "Run `langwatch agent dev` again on the machine that started the tunnel; a new session repoints the agent automatically",
      "If you are done developing locally, restore the agent's URL in its settings",
    ],
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
  monitor_evaluator_required: {
    tips: [
      "Create an evaluator first: langwatch evaluator create <name> --type <type>, then pass its id via evaluatorId",
      "Or pick an existing one: langwatch evaluator list",
    ],
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
  langy_rate_limited: {
    tips: ["Wait a few seconds before sending another message"],
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
  langy_api_credential_missing: {
    tips: [
      "Send the project API key as X-Auth-Token, Authorization: Bearer <token>, or Authorization: Basic base64(projectId:token)",
    ],
    docsPath: "/api-reference/api-keys/overview",
  },
  langy_api_credential_invalid: {
    tips: [
      "The token did not resolve to a project — check it was copied whole and has not been revoked",
    ],
    docsPath: "/api-reference/api-keys/overview",
  },
  langy_api_key_unowned: {
    tips: [
      "This key has no owning user, so there is no one for the turn to act as — mint a personal API key and use that instead",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  langy_api_key_no_langy_access: {
    tips: [
      "The user who owns this key cannot use Langy in this project — ask a workspace admin to grant Langy access, then retry",
    ],
  },
  langy_api_actor_missing: {
    tips: [
      "The user who owns this key no longer exists — mint a new key under a current user",
    ],
  },
  langy_api_request_invalid: {
    tips: [
      "Read the `issues` array in `meta` — it names the field that failed and why",
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

  // ---- licensing ----
  license_signing_key_not_pem: {
    tips: [
      "Provide the whole private key, including its BEGIN and END lines (PRIVATE KEY, RSA PRIVATE KEY and EC PRIVATE KEY are all accepted)",
      "A public key cannot sign — check that this is the private half of the license signing pair",
    ],
  },
  license_signing_key_encrypted: {
    tips: [
      "Provide an unencrypted private key — a passphrase-protected key cannot be used for signing",
    ],
  },
  license_signing_failed: {
    tips: [
      "Check that this is the license signing key and that it was copied in full",
    ],
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
