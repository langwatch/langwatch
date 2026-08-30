import { docsUrl } from "~/utils/docsUrl";

/**
 * Central remediation registry for handled errors; every `tips` / docs link
 * an error class emits lives here, keyed by the error's `code`. Error classes
 * spread `remediation(code)` into their constructor options instead of
 * inlining copy.
 *
 * Why central: one place to audit the agent-facing copy, and `docsPath` is a
 * repo-relative docs path (not a URL) so CI can verify every linked page
 * actually exists under `docs/` (see __tests__/error-remediation.unit.test.ts).
 *
 * Dynamic content (ids, counts, hints) does NOT belong here; classes compose
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
      "Read `reasons`; each entry names the offending field in meta.field and what was expected in meta.expected",
      "Fix those fields and send the request again; retrying it unchanged will fail identically",
    ],
  },
  malformed_request: {
    tips: [
      "The body could not be parsed at all; check for truncated JSON, a trailing comma, or a Content-Type that does not match what was sent",
    ],
  },

  // ---- dataset storage ----
  storage_not_writable: {
    tips: [
      "Set S3_BUCKET_NAME (with its credentials) so datasets are stored in object storage",
      "Or point LANGWATCH_LOCAL_STORAGE_PATH at a writable, persistent directory and restart the service",
      "The server log line next to this failure names the directory that was refused",
    ],
  },

  // ---- traces ----
  trace_not_found: {
    tips: [
      "Check the trace id; traces are deleted after the retention window",
      "If you just sent this trace, retry in a few seconds; ingestion is asynchronous",
    ],
    docsPath: "/platform/data-retention",
  },
  span_not_found: {
    tips: [
      "Check the span id; spans are deleted with their trace after the retention window",
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
      "Check the filter syntax near the indicated position; filters are field:value pairs combined with AND/OR",
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
      "Read `meta.violations`; each entry carries the line and column the parser stopped at",
      "The endpoint accepts native ClickHouse SQL; check for an unclosed quote, bracket, or parenthesis first",
    ],
  },
  lwql_not_permitted: {
    tips: [
      "Read `meta.violations`; each entry names the rule (`code`) and the clause (`clause`) that was refused",
      "Submit one read-only SELECT; writes, DDL, SETTINGS, FORMAT, INTO OUTFILE and table functions are all refused",
      "Read only the datasets the schema endpoint lists for this key, and select fields by name rather than with `*`",
    ],
  },
  lwql_parameter_missing: {
    tips: [
      "Read `meta.parameters`; it lists every parameter the SQL declares that the request left unset",
      "Send a value for each under `parameters`, keyed by the name inside the braces: `{since:DateTime}` reads `parameters.since`",
      "`period_start` and `period_end` are the exception; send them as `timeWindow: { start, end }`, never under `parameters`",
      "`period_granularity_seconds` is also an exception; send it as the request's own `granularitySeconds` field, never under `parameters`",
    ],
  },
  lwql_reserved_parameter_supplied: {
    tips: [
      "Read `meta.parameters`; it lists the reserved names the request set for itself",
      "`period_start` and `period_end` are supplied by the surface showing the chart; send `timeWindow: { start, end }` instead and drop them from `parameters`",
    ],
  },
  lwql_reserved_parameter_type: {
    tips: [
      "Read `meta.parameters`; it lists the reserved names declared with the wrong type",
      "Declare each as `DateTime` or `DateTime64`, for example `{period_start:DateTime}`; the interval they describe is half-open, `>= {period_start:DateTime} AND < {period_end:DateTime}`",
    ],
  },
  lwql_granularity_parameter_type: {
    tips: [
      "Read `meta.parameters`; it lists the parameter whose declaration was refused",
      "Declare period_granularity_seconds as UInt32, for example {period_granularity_seconds:UInt32}",
      "When the surface supplies the step itself, it must be one of the offered steps: 1 second, 1 minute, or 1 hour",
    ],
  },
  lwql_granularity_too_fine: {
    tips: [
      "The requested bucket size would produce more datapoints than one query may return for this period",
      "Use a bucket size that fits the range from the offered steps -- 1 second, 1 minute or 1 hour -- or narrow the date range",
    ],
  },
  lwql_granularity_requires_window: {
    tips: [
      "A chart declaring period_granularity_seconds must also declare {period_start:DateTime} and {period_end:DateTime}",
      "The bucket budget is computed against the period those two bounds describe",
    ],
  },
  lwql_not_enabled: {
    tips: [
      "The LangWatchQL feature is not enabled for this project; retrying will not help",
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
      "Check the chart id; a chart saved in another project is not readable from this one",
      "List the project's saved charts to see which ids exist",
    ],
  },
  saved_workbench_chart_dashboard_not_found: {
    tips: [
      "Check the dashboard id; a dashboard from another project cannot be used for placement in this project",
      "List the project's dashboards to see which ids exist",
    ],
  },
  saved_workbench_chart_specification_refused: {
    tips: [
      "Read `meta.errors`; each entry names the rule (`rule`) and the JSON path (`path`) that was refused",
      "A specification may only read the datasets the workbench registers, and may not load anything over the network",
      "The same specification is refused when rendering, so saving it unchanged will not help",
    ],
  },
  saved_workbench_chart_definition_invalid: {
    tips: [
      "This is a defect on our side; the stored chart cannot be read back and retrying will not help",
      "Save the chart again from the workbench to replace the unreadable definition",
    ],
  },
  lwql_unavailable: {
    tips: [
      "The LangWatchQL analytics SQL API is not provisioned on this deployment; retrying will not help",
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
      "This is a temporary platform issue; retry in a few seconds",
      "If it persists, check the LangWatch status page or contact support",
    ],
  },
  clickhouse_overloaded: {
    tips: [
      "Too many queries were running at once; retry in a few seconds",
      "Narrow the time range or add filters so the query costs less to run",
    ],
  },

  // ---- api keys ----
  api_key_not_found: {
    tips: [
      "Check the API key id; the key may have been deleted or never created",
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
      "Revoked keys cannot be reactivated; create a new API key if you need one",
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
      "A wider key or a higher role does not change this; make the change in LangWatch instead",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  api_key_scope_violation: {
    tips: [
      "A key cannot be granted a scope you do not hold yourself; lower the requested scope or ask an admin to create the key",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  project_visibility_too_wide: {
    tips: [
      "Bind the key to the teams or projects it works with instead of the whole organization",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  api_key_reserved_name: {
    tips: [
      "This name is reserved for keys LangWatch manages on your behalf; pick a different name",
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

  // ---- agent cache ----
  // Read by agent code inside a run, so the tips name the next call rather
  // than a page to open.
  cache_entry_not_found: {
    tips: [
      "Store the entry before you read it; a read never creates one",
      "Check the name, which is case sensitive",
      "An entry is gone once its lifetime passes; store it again with a longer one if the run needs it for longer",
    ],
    docsPath: "/agent-simulations/authenticated-agents",
  },

  // ---- connected agents ----
  agent_register_only: {
    tips: [
      "A connected agent is created and updated by the SDK when the decorated function's process starts; change the code and start the process again",
      "Only `config.description` can be edited through this API; the agent can also be archived",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  agent_test_refused: {
    tips: [
      "A test run sends the agent one message and waits for its answer; it needs an HTTP, code, workflow or connected agent whose configuration is complete",
      "Open the agent, fix what the message names, save it and test again",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  scenario_parameter_option_invalid: {
    tips: [
      "A parameter with options accepts only the values it lists; pick one of them for this run",
      "To accept another value, widen the options on the scenario, or on the decorated function of a connected agent",
    ],
    docsPath: "/agent-simulations/scenario-parameters",
  },
  agent_not_found: {
    tips: [
      "List the project's agents with `langwatch agent list` and use an id from that list",
      "An archived agent is not found; a connected agent that registers again restores its row",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  agent_offline: {
    tips: [
      "Start the process that runs the decorated function; the agent shows Online in the agents list once it connects",
      "Check that the process connects with the same project and environment as the agent you are running against",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  agent_owner_only: {
    tips: [
      "A development agent registered with a personal key belongs to that person; connect your own process to get your own copy",
      "To share one development agent with the team, register it with a project key or name its environment, for example dev-shared",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  agent_call_timeout: {
    tips: [
      "Raise the agent's timeout, up to the platform cap of 300 seconds",
      "Check the agent logs for the turn that did not finish",
    ],
  },
  agent_call_failed: {
    tips: [
      "Fix the error the function raised, then test again; the process logs carry the stack",
    ],
  },
  agent_disconnected: {
    tips: [
      "The turn is never sent again once the call reached the process, since the function may have side effects; start the process again and run again",
    ],
  },
  agent_instance_lost: {
    tips: [
      "A sticky agent pins each conversation to one instance; when that instance is gone the conversation fails rather than moving to another one",
      "Set `sticky` to false if the agent keeps no local state per conversation",
    ],
  },
  agent_busy: {
    tips: [
      "Wait `meta.retryAfterMs` milliseconds and send the call again",
      "Raise `concurrency` on the decorated function, or connect more instances",
    ],
  },
  agent_parameter_invalid: {
    tips: [
      "Parameter names start with a letter or underscore and hold only letters, digits and underscores",
      "Declare at most 20 parameters and at most 50 options per parameter",
      "A secret is declared on the scenario, never on the agent",
    ],
    docsPath: "/agent-simulations/scenario-parameters",
  },
  agent_register_refused: {
    tips: [
      "Read `meta.reason`: api_key_invalid, project_required, permission_denied, key_type_not_allowed, replica_count_unsupported, parameters_invalid or environment_invalid",
      "The key needs `scenarios:manage`; an ingestion key or a Langy session key can never connect",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  agent_session_unknown: {
    tips: [
      "Post a new register frame to /api/v1/agents/connect/register and use the instance token it answers with",
      "A session expires five minutes after its last poll",
    ],
    docsPath: "/agent-simulations/connect-your-agent",
  },
  agent_payload_too_large: {
    tips: [
      "Read `meta.what` and `meta.limitBytes`, and `meta.sizeBytes` when the payload was measured",
      "On a self-hosted deployment raise the cap with LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB",
    ],
  },

  // ---- agent dev tunnel ----
  agent_dev_tunnel_unreachable: {
    tips: [
      "Run `langwatch agent dev` again on the machine that started the tunnel; a new session repoints the agent automatically",
      "If you are done developing locally, restore the agent's URL in its settings",
    ],
  },

  // ---- scenario runs ----
  scenario_reserved_set_id: {
    tips: [
      "Send the run without a setId; it is then recorded in the project's own one-off bucket",
      "To group runs of your own, send a setId of your own choosing; any name outside the `__internal__` namespace is free",
      "A `__internal__<suiteId>__suite` address belongs to a run plan; start a run on that plan instead of writing into its address",
    ],
  },

  // ---- evaluations ----
  evaluation_not_found: {
    tips: [
      "Check the evaluation id; it may belong to a different project",
      "If the evaluation was just started, retry in a few seconds; evaluations run asynchronously",
    ],
    docsPath: "/evaluations/overview",
  },
  trace_not_evaluatable: {
    tips: [
      "Check that the trace contains the inputs/outputs the evaluator expects",
      "If the trace was just ingested, retry in a few seconds; ingestion is asynchronous",
    ],
    docsPath: "/evaluations/overview",
  },
  evaluator_config_error: {
    tips: [
      "Fix the evaluator config named in the message; check the evaluator's expected settings schema",
    ],
    docsPath: "/evaluations/evaluators/list",
  },
  evaluator_execution_error: {
    tips: [
      "Retry in a few seconds; the evaluator backend failed to execute this run",
      "If it persists, check the LangWatch status page or contact support",
    ],
  },
  evaluator_input_too_large: {
    tips: [
      "Shorten the input sent to this evaluator; the payload exceeded the evaluator's size limit",
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

  // ---- default models ----
  model_not_configured: {
    // The write is almost always organization scoped: providers are org rows,
    // and the onboarding seed lands the default config at ORGANIZATION so the
    // whole organization inherits. Naming the page AND the scope is what makes
    // this recoverable without a support round trip.
    tips: [
      "Open Settings, then Default Models, and set a model for the role in meta.role",
      "Set it at the organization scope so every team and project inherits it; a project scope covers that project only",
      "Enabling a provider is not enough on its own: the role still needs a model chosen for it",
    ],
    docsPath: "/platform/model-providers",
  },

  // ---- langy ----
  langy_conversation_not_found: {
    tips: [
      "Check the conversation id; it may be archived or belong to another project",
      "Start a new conversation to keep going",
    ],
  },
  langy_conversation_not_owned: {
    tips: [
      "Shared conversations can be viewed but only the owner can continue them; start a new conversation instead",
    ],
  },
  langy_conversation_id_unadoptable: {
    tips: [
      "Retry with a different conversation id, or omit `conversationId` to let the server generate one",
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
      "Ask a workspace admin to review the project's outbound network policy; Langy refuses to run rather than leak",
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
  langy_ui_turn_inactive: {
    tips: [
      "UI actions only work while your own turn is running; this command must be run by the agent during a conversation, not standalone",
    ],
  },
  langy_ui_action_unknown: {
    tips: [
      "Run `langwatch ui actions` to list the actions the current page accepts",
    ],
  },
  langy_ui_payload_invalid: {
    tips: [
      "Read meta.issues; each entry names the offending payload field and what was expected",
      "Run `langwatch ui actions` to see the action's payload schema",
    ],
  },
  langy_ui_no_browser: {
    tips: [
      "The user has no page open that can run this action; tell them what you wanted to do, or use the equivalent API command instead",
    ],
  },
  langy_ui_experiment_required: {
    tips: [
      "Pass --experiment <slug> so the backend knows which experiment to apply the action to; the slug is on the experiment context chip and in `langwatch experiment list`",
    ],
  },
  langy_ui_page_out_of_date: {
    tips: [
      "The open page holds an older version and cannot save. Pass --experiment <slug> so the change is applied to the saved evaluation instead, and tell the user their page needs a reload",
    ],
  },
  langy_ui_save_failed: {
    tips: [
      "The page applied the change but could not write it to the server, so the saved evaluation does not have it. Do not build the next step on it: pass --experiment <slug> to apply the change to the saved evaluation instead",
    ],
  },
  langy_ui_timeout: {
    tips: [
      "The page may have applied part of the action; read the current state (for example `langwatch workbench get-state`) before retrying",
    ],
  },
  langy_ui_handler_failed: {
    tips: [
      "Read meta.errorCode for the page's own failure reason, re-read the current state, and adjust the payload before retrying",
    ],
  },
  langy_rate_limited: {
    tips: ["Wait a few seconds before sending another message"],
  },
  langy_turn_not_stoppable: {
    tips: [
      "Read the conversation to find the turn it currently has in flight, and stop that one",
      "A turn that already finished needs no stopping; its answer is on the conversation",
    ],
  },
  langy_idempotency_mismatch: {
    tips: [
      "The same idempotency key was reused with different content; mint a fresh key for every new send",
    ],
  },
  langy_empty_message: {
    tips: ["Send a message with actual text content"],
  },
  langy_dispatch_rejected: {
    tips: [
      "The agent rejected this turn's request as invalid, it will not be retried; send a new message",
    ],
  },
  langy_agent_unavailable: {
    tips: [
      "Retry in a few seconds; the agent is down, mid-deploy, or restarting",
    ],
  },
  langy_agent_at_capacity: {
    tips: [
      "Too many conversations are running at once; wait a few seconds and retry",
    ],
  },
  langy_agent_session_lost: {
    tips: [
      "The agent dropped this conversation before finishing; resend the message to pick it back up",
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
      "The token did not resolve to a project; check it was copied whole and has not been revoked",
    ],
    docsPath: "/api-reference/api-keys/overview",
  },
  langy_api_key_unowned: {
    tips: [
      "This key has no owning user, so there is no one for the turn to act as; mint a personal API key and use that instead",
    ],
    docsPath: "/api-reference/api-keys/create-api-key",
  },
  langy_api_key_no_langy_access: {
    tips: [
      "The user who owns this key cannot use Langy in this project; ask a workspace admin to grant Langy access, then retry",
    ],
  },
  langy_api_actor_missing: {
    tips: [
      "The user who owns this key no longer exists; mint a new key under a current user",
    ],
  },
  langy_api_request_invalid: {
    tips: [
      "Read the `issues` array in `meta`; it names the field that failed and why",
    ],
  },
  langy_github_repo_not_accessible: {
    tips: [
      "Grant the LangWatch GitHub App access to that repository (Settings → Integrations → Configure), then retry",
    ],
  },
  langy_worker_spawn_failed: {
    tips: [
      "The agent failed to start for this turn; nothing was lost, retry in a moment",
    ],
  },
  langy_worker_stopped: {
    tips: [
      "The worker died mid-reply and the server already exhausted its recovery; the message is on record, retry manually",
    ],
  },
  langy_agent_errored: {
    tips: [
      "The model call was rejected upstream; check meta/reasons for the provider's typed failure, then retry",
    ],
  },
  langy_turn_timeout: {
    tips: [
      "Retry, or ask for a narrower slice: a shorter time range or a single trace",
    ],
  },
  langy_worker_restarting: {
    tips: ["An update interrupted this reply; resend the message"],
  },

  // ---- licensing ----
  license_signing_key_not_pem: {
    tips: [
      "Provide the whole private key, including its BEGIN and END lines (PRIVATE KEY, RSA PRIVATE KEY and EC PRIVATE KEY are all accepted)",
      "A public key cannot sign; check that this is the private half of the license signing pair",
    ],
  },
  license_signing_key_encrypted: {
    tips: [
      "Provide an unencrypted private key; a passphrase-protected key cannot be used for signing",
    ],
  },
  license_signing_failed: {
    tips: [
      "Check that this is the license signing key and that it was copied in full",
    ],
  },
} as const satisfies Record<string, RemediationEntry>;

export type RemediationCode = keyof typeof registry;

/** All registered codes; used by the registry test to catch typos. */
export const REMEDIATION_CODES = Object.keys(registry) as RemediationCode[];

/** Every docsPath in the registry; consumed by the docs-existence CI test. */
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

/**
 * The tips for a code that is only known at runtime.
 *
 * One error can carry another's code: the UI-action channel wraps whatever the
 * page reported, and its own advice is "read meta.errorCode for the page's own
 * reason". Following that advice should then reach the inner code's tips rather
 * than end at its name, so the wrapper looks the inner code up here. Unknown
 * codes answer with nothing, because a code from a page is data.
 */
export function remediationFor(code: string | undefined): {
  tips?: readonly string[];
  docsUrl?: string;
} {
  if (!code || !(code in registry)) return {};
  return remediation(code as RemediationCode);
}
