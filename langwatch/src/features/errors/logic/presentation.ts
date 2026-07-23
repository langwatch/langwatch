import type {
  GoErrorCode,
  HandledErrorFault,
  NodeErrorCode,
  SerializedHandledError,
} from "@langwatch/handled-error";

import type { AppErrorCode } from "./codes";
import {
  type HandledErrorShape,
  handledShapeFromSerialized,
  readAuthoredMessage,
  readHandledError,
  safeProse,
} from "./readHandledError";

/**
 * The customer-facing copy for every handled-error code, keyed by code.
 *
 * This registry is where the words live. Since #5984 the wire message for a
 * handled error IS its code, so the server sends `project_slug_taken` and
 * nothing else — deliberately, because handled-error messages are server copy
 * that name env vars and internal services. Everything a customer reads about
 * an error is written here.
 *
 * The `satisfies` at the bottom is load-bearing: it is exhaustive over every
 * app code AND every code generated from the Go services, so adding an error
 * anywhere in the platform without writing its copy fails `pnpm typecheck`.
 *
 * Copy rules (`dev/docs/best_practices/copywriting.md`):
 *   - `title` is a short, calm statement of what happened. Sentence case, no
 *     terminal punctuation, never a code slug.
 *   - `describe` says what to do about it. Skip it when the title already
 *     says everything — an empty description beats padding.
 *   - Never name internals. "The analysis service timed out" is a leak;
 *     "This search took too long" is the same fact, told to a customer.
 *
 * `tips` and `docsUrl` are NOT here — they ride on the error itself from the
 * server's remediation registry (`src/server/app-layer/error-remediation.ts`)
 * because agents driving the API and CLI need them without a UI.
 */
export interface ErrorPresentation {
  title: string;
  /**
   * Optional body copy. Receives the error so it can use `meta` — but only
   * where this registry knows the shape of that meta, which is the whole
   * point: `meta` is a contract per code, not a bag to rummage through.
   */
  describe?: (error: HandledErrorShape) => string;
}

/** Reads a string out of `meta` without trusting it. */
const str = (
  error: HandledErrorShape,
  key: string,
  fallback: string,
): string => {
  const value = error.meta[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
};

const presentations = {
  // ---- traces & spans ----
  trace_not_found: {
    title: "Trace not found",
    describe: () =>
      "It may have been deleted, or it may still be arriving. Traces take a few seconds to appear.",
  },
  span_not_found: {
    title: "Span not found",
    describe: () => "It may have been deleted along with its trace.",
  },
  trace_not_evaluatable: {
    title: "This trace can't be evaluated",
    describe: () => "It doesn't have the input and output an evaluator needs.",
  },

  // ---- querying & filtering ----
  query_timeout: {
    title: "This search took too long",
    describe: () => "Narrow the time range or add a filter, then try again.",
  },
  query_memory_exceeded: {
    title: "This search was too large",
    describe: () =>
      "Narrow the time range, add a filter, or select fewer fields.",
  },
  time_range_too_wide: {
    title: "Time range is too wide",
    describe: () => "Pick a shorter range and try again.",
  },
  filter_parse_error: {
    title: "This filter isn't valid",
    describe: () => "Check the syntax and try again.",
  },
  filter_field_unknown: {
    title: "Unknown filter field",
    describe: (error) => {
      const field = str(error, "field", "");
      return field ? `There's no field called "${field}".` : "";
    },
  },
  clickhouse_unavailable: {
    title: "Search is temporarily unavailable",
    describe: () => "We're on it. Try again in a moment.",
  },
  broadcaster_not_active: {
    title: "Live updates disconnected",
    describe: () => "Refresh the page to reconnect.",
  },

  // ---- evaluations & experiments ----
  evaluation_not_found: { title: "Evaluation not found" },
  evaluator_not_found: { title: "Evaluator not found" },
  evaluator_config_error: {
    title: "This evaluator isn't configured correctly",
    describe: () => "Check its settings and try again.",
  },
  evaluator_execution_error: {
    title: "The evaluator failed to run",
    // `meta.reason` is a machine sub-classifier ("auth_failed") for branching,
    // never prose — so branch on it and return authored copy, never the value.
    //
    // Both signals, because the two producers disagree: the experiments-v3
    // mapper sets `reason: "auth_failed"`, while the langevals HTTP client
    // (the other, busier producer) attaches only `meta.httpStatus`. Reading
    // one of them meant half of the rejected-key failures read "try running it
    // again" — advice that cannot work.
    describe: (error) => {
      const status = error.meta.httpStatus;
      const isAuthFailure =
        str(error, "reason", "") === "auth_failed" ||
        status === 401 ||
        status === 403;
      return isAuthFailure
        ? "Check the API key for this evaluator's model provider."
        : "Try running it again.";
    },
  },
  evaluator_missing_field: {
    title: "The evaluator needs another field",
    describe: (error) => {
      // meta.field is the wire identifier ("candidate_a_id"); the error class
      // documents it as something to translate, not to render.
      const label = EVALUATOR_FIELD_LABELS[str(error, "field", "")];
      return label
        ? `Map a value to ${label} before running this evaluator.`
        : "Map all of its required fields before running it.";
    },
  },
  evaluator_input_too_large: {
    title: "That's too much text for this evaluator",
    describe: () => "Shorten the input and try again.",
  },
  experiment_not_found: { title: "Experiment not found" },
  dspy_step_not_found: { title: "Optimization step not found" },
  system_prompt_required: {
    title: "A system prompt is required",
    describe: () => "Add one before running this.",
  },
  system_prompt_conflict: {
    title: "Set one prompt, not both",
    describe: () =>
      "This prompt has both a system prompt and a prompt. Remove one.",
  },

  // ---- API keys ----
  api_key_not_found: { title: "API key not found" },
  api_key_not_owned: {
    title: "You don't have access to this API key",
  },
  api_key_already_revoked: {
    title: "This API key is already revoked",
  },
  api_key_permission_denied: {
    title: "You don't have permission to manage API keys",
    describe: () => "Ask an admin on your team for access.",
  },
  api_key_reserved_name: {
    title: "That name is reserved",
    describe: () => "Pick a different name for this key.",
  },
  api_key_scope_violation: {
    title: "This API key can't do that",
    describe: () => "It doesn't include the required scope.",
  },

  // ---- access, org & limits ----
  project_not_found: { title: "Project not found" },
  organization_not_found_for_team: { title: "Organization not found" },
  malformed_custom_role_permissions: {
    title: "This role's permissions are invalid",
    describe: () => "Edit the role and save it again.",
  },
  lite_member_restricted: {
    title: "Your account doesn't include this",
    describe: () => "Ask an admin on your team to upgrade your access.",
  },
  cannot_impersonate_admin: {
    // A deliberate denial, not a mistake to correct: admin-to-admin
    // impersonation is refused so the audit trail stays attached to whoever
    // actually acted. Saying "check your input" would invite a retry that is
    // designed never to work.
    title: "Admins can't be impersonated",
    describe: () => "This is only available for accounts that aren't admins.",
  },
  cannot_impersonate_deactivated_user: {
    title: "This account is deactivated",
    describe: () =>
      "Its sessions were revoked on purpose. Reactivate the account first.",
  },
  user_to_impersonate_not_found: {
    title: "User not found",
    describe: () => "They may have been removed since this page loaded.",
  },
  resource_limit_exceeded: {
    title: "You've hit a plan limit",
    describe: () => "Upgrade your plan to raise it.",
  },
  // Browser-telemetry ingest (ADR-058). These answer the RUM endpoint rather
  // than a screen, so the reader is usually an engineer with the network tab
  // open — the copy names what the endpoint refused and what changes it.
  rum_ingest_disabled: {
    title: "Browser telemetry isn't enabled",
    describe: () =>
      "Turn on browser monitoring for this project to collect it.",
  },
  rum_payload_invalid: {
    title: "That telemetry report couldn't be read",
    describe: () => "The browser sent a body this endpoint doesn't recognise.",
  },
  rum_payload_too_large: {
    title: "That telemetry report is too big",
    describe: () => "Send smaller batches of browser spans.",
  },
  rum_rate_limited: {
    title: "Too many telemetry reports",
    describe: () =>
      "Browser monitoring is sending faster than we accept. It will resume on its own.",
  },
  scenario_set_limit_exceeded: {
    title: "You've hit the simulation set limit",
    describe: () => "Delete an existing set, or upgrade your plan.",
  },
  subscription_service_unavailable: {
    // Not a blip: this is raised only when a Stripe-dependent action runs on a
    // self-hosted deployment, where there is no billing provider at all. The
    // old "try again in a moment" invited the customer to keep retrying a
    // permanent condition.
    title: "Billing isn't available here",
    describe: () =>
      "This is a self-hosted deployment, so plans are managed outside the app.",
  },

  // ---- governance ----
  anomaly_rule_not_found: {
    title: "Anomaly rule not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  ingestion_source_not_found: {
    title: "Ingestion source not found",
    describe: () =>
      "It may have been archived. Reload to see the current list.",
  },

  // ---- datasets ----
  dataset_name_taken: {
    title: "That name is taken",
    describe: () => "Pick a different name for this dataset.",
  },

  // ---- shared trace links (ADR-057) ----
  // The first five answer the anonymous share surface, so the reader is a
  // recipient who did nothing wrong and cannot fix the link — the copy points
  // them back at whoever shared it. `share_link_not_found` deliberately reads
  // the same whether the token never existed, sharing was switched off, or the
  // trace is gone: the server collapses all three so a prober learns nothing,
  // and the copy must not undo that by hinting which happened.
  share_link_not_found: {
    title: "This shared link isn't available",
    describe: () =>
      "It may have been removed, or sharing has been turned off. Ask whoever shared it for a new link.",
  },
  share_link_forbidden: {
    // 401, not 403: the viewer is invited to sign in rather than told the link
    // is dead. Copy works for the anonymous prober and the wrong-account member
    // alike.
    title: "You need access to view this",
    describe: () =>
      "This link is limited to certain people. Sign in with an account that can see it.",
  },
  share_link_expired: {
    title: "This shared link has expired",
    describe: () => "Ask whoever shared it for a new link.",
  },
  share_link_exhausted: {
    title: "This shared link has already been viewed",
    describe: () =>
      "It was set to open a limited number of times. Ask whoever shared it for a new link.",
  },
  share_read_rate_limited: {
    title: "This shared trace is busy right now",
    describe: () =>
      "It's being opened a lot at the moment. Wait a few seconds, then refresh.",
  },
  // The one sharer-facing code here: raised when someone tries to mint a trace
  // link while the project has sharing switched off.
  trace_sharing_disabled: {
    title: "Sharing is turned off for this project",
    describe: () =>
      "Ask a project admin to turn on trace sharing before creating a link.",
  },

  // ---- suites (run plans) ----
  suite_not_found: { title: "Run plan not found" },
  suite_name_taken: {
    title: "That name is already taken",
    describe: () => "Pick a different name for this run plan.",
  },
  suite_all_scenarios_archived: {
    title: "Every scenario in this run plan is archived",
    describe: () => "Edit the plan to include active scenarios.",
  },
  suite_all_targets_archived: {
    title: "Every target in this run plan is archived",
    describe: () => "Edit the plan to include active targets.",
  },
  suite_invalid_scenario_references: {
    title: "This run plan points at scenarios that no longer exist",
    describe: () => "Edit the plan to remove them.",
  },
  suite_invalid_target_references: {
    title: "This run plan points at targets that no longer exist",
    describe: () => "Edit the plan to remove them.",
  },

  // ---- automations & notifications ----
  template_validation_error: {
    title: "This template isn't valid",
    // The parser's position is the whole value of this error — the customer
    // wrote the template — but it is still server-supplied prose, so it is
    // clamped like every other sentence that isn't authored in this file.
    describe: (error) =>
      safeProse(str(error, "syntaxError", "")) ||
      "Check the template and try again.",
  },
  invalid_email_recipient: {
    title: "That email address isn't valid",
    describe: (error) => {
      const recipient = str(error, "recipient", "");
      return recipient ? `We can't send to "${recipient}".` : "";
    },
  },
  invalid_action_params: {
    title: "This action isn't configured correctly",
    describe: () => "Check its settings and try again.",
  },
  missing_slack_webhook: {
    title: "Slack webhook missing",
    describe: () => "Paste a Slack incoming webhook URL to continue.",
  },
  missing_slack_bot_token: {
    title: "Slack isn't connected",
    describe: () => "Connect Slack before sending to a channel.",
  },
  missing_annotator: {
    title: "No annotator assigned",
    describe: () => "Add at least one annotator to the queue.",
  },
  notification_delivery_error: {
    title: "We couldn't deliver that notification",
    // The one registry entry that prefers the server's words to its own. The
    // provider knows why it rejected the message and `explainSlackPostError`
    // turns that into real remediation ("invite the bot with /invite
    // @LangWatch"); "check the destination and try again" is what is left when
    // that sentence is thrown away.
    describe: (error) =>
      safeProse(str(error, "message", "")) ||
      "Check the destination and try again.",
  },
  test_fire_unavailable: {
    title: "Nothing to test yet",
    // `meta.reason` is the sentence the service wrote for this exact case
    // ("This automation has no email recipients to test-fire to.") — it names
    // WHICH piece is missing, which the generic line cannot. It is also the
    // error's own message, authored server-side, never relayed.
    describe: (error) => {
      const reason = safeProse(str(error, "reason", ""));
      if (reason) return reason;
      const channel = str(error, "channel", "");
      return channel
        ? `Configure the ${channel} destination first.`
        : "Configure the destination first.";
    },
  },

  // ==========================================================================
  // Langy.
  //
  // These entries are the authoring surface for Langy's error copy too:
  // `features/langy/logic/langyErrorExplainer.ts` reads its title and
  // description from here and keeps only the decisions it actually owns (card
  // vs inline vs suppress, which action button, whether to show the reason
  // chain). Two authorings had already contradicted each other —
  // `langy_egress_misconfigured` read "we're on it, try again shortly" here
  // and "a network policy an admin must fix" there, and only one of them was
  // true. One code, one set of words.
  // ==========================================================================
  langy_conversation_not_found: {
    title: "Conversation not found",
    describe: () =>
      "This conversation is no longer available. Start a new chat to keep going.",
  },
  langy_conversation_not_owned: {
    title: "This conversation belongs to someone else",
    describe: () =>
      "You can view shared conversations but only the owner can continue them.",
  },
  langy_empty_message: {
    title: "Nothing to send",
    describe: () => "Type a message first.",
  },
  langy_idempotency_mismatch: {
    title: "That message was already sent",
    describe: () => "Refresh to see the conversation as it stands.",
  },
  langy_dispatch_rejected: {
    title: "That request couldn't be understood",
    describe: () => "Rephrase and try again.",
  },
  langy_turn_in_progress: {
    title: "Langy is still replying",
    describe: () =>
      "There's already a response in progress for this conversation. Wait for it to finish before sending another message.",
  },
  langy_turn_not_stoppable: {
    title: "That reply already finished",
    describe: () => "Refresh to see the conversation as it stands.",
  },
  langy_turn_timeout: {
    title: "That took too long",
    describe: () =>
      "Langy didn't finish in time. Try again, or ask for a narrower slice: a shorter time range, or a single trace.",
  },
  langy_agent_at_capacity: {
    title: "Langy is busy right now",
    describe: () =>
      "Too many conversations are running at once. Give it a few seconds and try again.",
  },
  langy_agent_unavailable: {
    title: "Langy is unavailable",
    describe: () =>
      "Langy can't be reached right now. Your message is safe, so send it again in a moment.",
  },
  langy_agent_errored: {
    title: "Langy's reply failed",
    describe: () =>
      "Langy hit an error while writing this reply. Your message is safe, so try again.",
  },
  langy_agent_session_lost: {
    title: "Langy lost its place",
    describe: () =>
      "Langy dropped this conversation before the reply finished. Send your message again to pick it back up.",
  },
  langy_worker_restarting: {
    title: "Langy restarted",
    describe: () =>
      "An update interrupted this reply. Nothing was lost, so send your message again.",
  },
  langy_worker_stopped: {
    title: "Langy's worker stopped",
    describe: () =>
      "Langy's worker stopped before it could finish. Nothing you did is wrong and your message is safe, so try again.",
  },
  langy_worker_spawn_failed: {
    title: "Langy couldn't start up",
    describe: () =>
      "Langy failed to get going for this reply. Nothing was lost, so try again in a moment.",
  },
  langy_credential_resolution: {
    title: "Couldn't verify your access",
    describe: () => "Sign out and back in, then try again.",
  },
  langy_model_not_configured: {
    title: "Choose a model for Langy",
    describe: () =>
      "Langy needs a model to run. Pick one in your project's model settings, then try again.",
  },
  langy_model_not_allowed: {
    title: "That model isn't available here",
    describe: () =>
      "The model you picked isn't enabled for this project. Choose one of the configured models and send again.",
  },
  langy_not_enabled: {
    title: "Langy isn't available on this account",
    describe: () => "Contact support if you'd like access.",
  },
  langy_insufficient_scope: {
    title: "Langy doesn't have access here",
    describe: () =>
      "Langy doesn't have the permissions it needs in this project. Ask a workspace admin to grant them.",
  },
  langy_github_not_connected: {
    title: "Install the GitHub App to continue",
    describe: () =>
      "Langy needs the LangWatch GitHub App installed to open pull requests.",
  },
  langy_github_repo_not_accessible: {
    title: "That repository isn't available to Langy",
    describe: () =>
      "The LangWatch GitHub App doesn't have access to that repository. Grant it access from Settings → Integrations → Configure, then try again.",
  },
  langy_egress_misconfigured: {
    // Fail-closed network policy: Langy refuses to run rather than leak. Not a
    // blip and not the customer's mistake — an admin has to fix the policy, so
    // "try again shortly" was advice that could only ever fail.
    title: "Langy is blocked by a network policy",
    describe: () =>
      "Langy's outbound network policy for this project is misconfigured, so it can't run safely. Ask a workspace admin to review it.",
  },

  // ---- validation ----
  validation_error: {
    title: "Check your input",
    describe: (error) => {
      // Zod flattens to the INPUT SCHEMA's property names, which are wire
      // identifiers: every procedure takes a `projectId` the customer never
      // sees. Name only fields that exist on screen, and name them the way the
      // screen does; the per-field detail has a proper home anyway
      // (applyHandledErrorToForm).
      const fieldErrors = error.meta.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const labels = Object.keys(fieldErrors)
          .map((field) => USER_VISIBLE_FIELDS[field])
          .filter((label): label is string => !!label);
        if (labels.length > 0) {
          return `There's a problem with ${listLabels(labels)}.`;
        }
      }
      const formErrors = error.meta.formErrors;
      if (Array.isArray(formErrors)) {
        const first = formErrors.find(
          (entry): entry is string => typeof entry === "string",
        );
        if (first) return safeProse(first);
      }
      return "Some of the values aren't valid.";
    },
  },
  schema_failure: {
    // One offending field, as a link in a `validation_error`'s reason chain —
    // and, when a route raises it alone, an error in its own right.
    title: "Check your input",
    describe: (error) => {
      const label = USER_VISIBLE_FIELDS[str(error, "field", "")];
      return label
        ? `There's a problem with ${label}.`
        : "Some of the values aren't valid.";
    },
  },
  malformed_request: {
    title: "That request couldn't be read",
    describe: () => "Check the format of what was sent, then try again.",
  },
  // ==========================================================================
  // Codes raised by the Go services (generated into `goErrorCodes` by
  // cmd/herrgen). They reach the browser whenever the control plane proxies a
  // Go service — an `herr.E` adapts into a HandledError losslessly, so a
  // gateway or agent failure arrives here as a first-class handled error.
  //
  // Some of these can only ever happen server-to-server and no customer will
  // realistically see them. They still need copy, because the type demands it
  // and because "realistically" is doing a lot of work in that sentence.
  // ==========================================================================

  // ---- AI gateway ----
  invalid_api_key: {
    title: "That API key isn't valid",
    describe: () => "Check the key, or generate a new one in settings.",
  },
  virtual_key_revoked: {
    title: "This API key has been revoked",
    describe: () => "Generate a new one in settings.",
  },
  budget_exceeded: {
    title: "You've reached your spending limit",
    describe: () => "Raise the limit in settings to keep going.",
  },
  rate_limited: {
    title: "Too many requests",
    describe: () => "Slow down for a moment, then try again.",
  },
  model_not_allowed: {
    title: "That model isn't allowed",
    describe: () => "Pick a different model, or ask an admin to allow it.",
  },
  no_provider_configured: {
    title: "No model provider configured",
    describe: () => "Add a provider in settings to continue.",
  },
  guardrail_blocked: {
    title: "Blocked by a guardrail",
    describe: () => "This request didn't pass one of your configured policies.",
  },
  policy_violation: {
    title: "Blocked by a policy",
    describe: () => "This request isn't allowed by your organization's rules.",
  },
  provider_error: {
    title: "The model provider returned an error",
    describe: () => "Try again, or switch to a different provider.",
  },
  provider_timeout: {
    title: "The model provider timed out",
    describe: () => "Try again in a moment.",
  },
  chain_exhausted: {
    title: "Every provider failed",
    describe: () => "Check your provider settings, then try again.",
  },
  circuit_open: {
    title: "Paused after repeated failures",
    describe: () => "We'll retry automatically. Try again shortly.",
  },
  auth_upstream_unavailable: {
    title: "Couldn't verify your access",
    describe: () => "Try again in a moment.",
  },

  // ---- NLP engine ----
  invalid_workflow: {
    title: "This workflow isn't valid",
    describe: () => "Check the steps and try again.",
  },
  invalid_dataset: {
    title: "This dataset isn't valid",
    describe: () => "Check its columns and try again.",
  },
  unsupported_node_kind: {
    title: "This step isn't supported",
    describe: () => "Remove or replace it to run the workflow.",
  },
  jsonpath_no_match: {
    title: "A field didn't match anything",
    describe: () => "Check the field path against your data.",
  },
  code_block_timeout: {
    title: "A code step took too long",
    describe: () => "Simplify it, or reduce how much data it processes.",
  },
  idle_timeout: {
    title: "This run timed out",
    describe: () => "Try running it again.",
  },
  child_unavailable: {
    title: "Temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  gateway_unavailable: {
    title: "Temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  upstream_http_error: {
    title: "A connected service returned an error",
    describe: (error) =>
      describeUpstreamStatus({
        error,
        whenAbsent: "Try again in a moment.",
        whenOther: "Check its configuration, then try again.",
      }),
  },
  guardrail_attach_forbidden: {
    title: "You don't have permission to attach guardrails",
    describe: () => "Ask an admin on your team for access to this project.",
  },
  ssrf_blocked: {
    title: "That address isn't allowed",
    describe: () => "Use a public URL that isn't on an internal network.",
  },
  config_invalid: {
    title: "A service isn't set up correctly",
    // Deliberately says nothing more. `pkg/config` builds this error's meta by
    // resolving each failed struct field to its environment variable name, so
    // the detail here is literally a list of our env vars — the operator finds
    // them in the service logs, where they belong. This is the clearest case
    // in the registry of a code whose meta must never be rendered.
    describe: () => "This one's on us — we've been notified.",
  },

  // ---- Langy agent ----
  agent_error: {
    title: "Something went wrong mid-answer",
    describe: () => "Try asking again.",
  },
  conversation_busy: {
    title: "Still answering",
    describe: () => "Wait for the current reply to finish.",
  },
  credentials_required: {
    title: "Couldn't verify your access",
    describe: () => "Try again. This usually resolves itself.",
  },
  invalid_conversation_id: { title: "Conversation not found" },
  opencode_session_not_found: {
    title: "The session was lost",
    describe: () => "Start a new message to continue.",
  },
  opencode_auth_not_enforced: {
    title: "Temporarily unavailable",
    describe: () => "We're on it. Try again shortly.",
  },
  max_workers_reached: {
    title: "Busy right now",
    describe: () => "Try again in a moment.",
  },
  no_free_worker_uid: {
    title: "Busy right now",
    describe: () => "Try again in a moment.",
  },
  worker_not_ready: {
    title: "Still starting up",
    describe: () => "Try again in a moment.",
  },
  worker_spawn_failed: {
    title: "Couldn't start a session",
    describe: () => "Try again in a moment.",
  },

  // ---- shared / transport ----
  bad_request: {
    title: "Check your input",
    describe: () => "Some of the values sent weren't valid.",
  },
  unprocessable_entity: {
    title: "Check your input",
    describe: () => "The request was understood, but some values aren't valid.",
  },
  payload_too_large: {
    title: "That's too large to send",
    describe: () => "Try again with less data.",
  },
  not_found: { title: "Not found" },
  unauthorized: {
    title: "You're not signed in",
    describe: () => "Sign in again to continue.",
  },
  internal_error: {
    title: "Something went wrong on our end",
    describe: () => "We've been notified. Try again in a moment.",
  },
  // ==========================================================================
  // Workflow node failures from the nlpgo engine (generated into
  // `nodeErrorCodes` by cmd/herrgen). These reach the customer on an
  // experiments-v3 / optimization-studio target cell; the audience is someone
  // building a workflow, so the copy points at the node they can fix.
  // `invalid_dataset`, `unsupported_node_kind` and `upstream_http_error` are
  // shared with the herr codes above and already have copy.
  // ==========================================================================

  // ---- HTTP node ----
  http_error: {
    title: "Couldn't reach the agent",
    describe: () =>
      "Check the URL is correct and the service is reachable, then run again.",
  },
  http_executor_unavailable: {
    title: "HTTP requests are temporarily unavailable",
    describe: () => "Try again in a moment.",
  },

  // ---- LLM node ----
  llm_error: {
    title: "The model call failed",
    // The engine attaches the provider's status here whenever it got one, and
    // without reading it an expired key, a rate limit and a provider outage
    // all read "check the node's model configuration" — advice that is right
    // once in three.
    describe: (error) =>
      describeUpstreamStatus({
        error,
        whenAbsent: "Try again, or check the node's model configuration.",
        whenOther: "Check the node's model configuration, then run again.",
        whenRejected:
          "Check the API key for this model provider, then run again.",
      }),
  },
  llm_executor_unavailable: {
    title: "The model runner is temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  llm_model_not_set: {
    title: "This step has no model selected",
    describe: () => "Open the node and choose a model.",
  },

  // ---- code node ----
  code_runner_error: {
    title: "The code step failed",
    describe: () => "Check the node's code and its inputs, then run again.",
  },
  code_runner_unavailable: {
    title: "The code runner is temporarily unavailable",
    describe: () => "Try again in a moment.",
  },

  // ---- evaluator node ----
  evaluator_error: {
    title: "The evaluator failed to run",
    describe: (error) =>
      describeUpstreamStatus({
        error,
        whenAbsent: "Check its configuration, then run again.",
        whenOther: "Check its configuration, then run again.",
        whenRejected:
          "Check the API key for this evaluator's model provider, then run again.",
      }),
  },
  evaluator_executor_unavailable: {
    title: "The evaluator runner is temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  evaluator_missing_slug: {
    title: "This evaluator isn't fully configured",
    describe: () => "Pick an evaluator type for the node.",
  },
  evaluator_unauthorized: {
    title: "Not allowed to run this evaluator",
    describe: () => "Check your access, or ask an admin on your team.",
  },
  evaluator_unconfigured: {
    title: "This evaluator isn't configured",
    describe: () => "Finish setting it up before running.",
  },

  // ---- agent node ----
  agent_workflow_error: {
    title: "The agent step failed",
    describe: (error) =>
      describeUpstreamStatus({
        error,
        whenAbsent: "Check the agent's configuration, then run again.",
        whenOther: "Check the agent's configuration, then run again.",
      }),
  },
  agent_workflow_executor_unavailable: {
    title: "The agent runner is temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  agent_unconfigured: {
    title: "This agent isn't configured",
    describe: () => "Finish setting it up before running.",
  },
  agent_unauthorized: {
    title: "Not allowed to run this agent",
    describe: () => "Check your access, or ask an admin on your team.",
  },
  agent_missing_type: {
    title: "This agent step is incomplete",
    describe: () => "Choose what the agent should do.",
  },
  agent_unknown_type: {
    title: "This agent type isn't supported",
    describe: () => "Pick a supported agent type for the node.",
  },
  agent_missing_workflow_id: {
    title: "This agent isn't linked to a workflow",
    describe: () => "Select the workflow it should run.",
  },

  // ---- custom-workflow node ----
  custom_workflow_error: {
    title: "The referenced workflow failed",
    describe: (error) =>
      describeUpstreamStatus({
        error,
        whenAbsent: "Open it to see what went wrong, then run again.",
        whenOther: "Open it to see what went wrong, then run again.",
      }),
  },
  custom_workflow_executor_unavailable: {
    title: "The workflow runner is temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  custom_unconfigured: {
    title: "This workflow step isn't configured",
    describe: () => "Finish setting it up before running.",
  },
  custom_unauthorized: {
    title: "Not allowed to run that workflow",
    describe: () => "Check your access, or ask an admin on your team.",
  },
  custom_missing_workflow_id: {
    title: "This step isn't linked to a workflow",
    describe: () => "Select the workflow it should run.",
  },

  // ---- other node failures ----
  invalid_condition: {
    title: "A condition in this workflow isn't valid",
    describe: () => "Check the branch condition and try again.",
  },
  attachment_fetch_error: {
    title: "Couldn't load an attachment",
    describe: () => "Check the file is still available, then run again.",
  },
  context_canceled: {
    title: "The run was cancelled",
    describe: () => "Start it again when you're ready.",
  },
  engine_error: {
    title: "The run couldn't be set up",
    describe: () => "Check the workflow and its dataset, then try again.",
  },
} satisfies Record<
  AppErrorCode | GoErrorCode | NodeErrorCode,
  ErrorPresentation
>;

/**
 * Wire identifiers translated into the words the evaluator UI puts on screen.
 *
 * `meta.field` arrives as `candidate_a_id`; the customer is looking at a
 * column labelled "Variant A". An unmapped field means we have no idea what
 * the customer calls it, so the copy stays generic rather than guessing.
 */
const EVALUATOR_FIELD_LABELS: Record<string, string> = {
  candidate_a_id: "Variant A",
  candidate_b_id: "Variant B",
  input: "the input",
  output: "the output",
  expected_output: "the expected output",
  contexts: "the contexts",
};

/**
 * Schema keys a customer can actually see, mapped to what the screen calls
 * them.
 *
 * Anything not here is a wire identifier — `projectId`, `organizationId`,
 * `checkId` — and naming it in a toast is the same leak as showing a code
 * slug, just via `meta` instead of `message`. The keys that ARE visible still
 * are not labels: quoting `slug` back at someone who is looking at a field
 * marked "URL slug" reads as a different thing entirely, so this translates
 * the same way `EVALUATOR_FIELD_LABELS` does.
 */
const USER_VISIBLE_FIELDS: Record<string, string> = {
  name: "the name",
  slug: "the URL slug",
  email: "the email address",
  description: "the description",
  url: "the URL",
  prompt: "the prompt",
  model: "the model",
  value: "the value",
  label: "the label",
  title: "the title",
};

/** Joins labels into "a", "a and b", "a, b and c". */
function listLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0]!;
  const rest = [...labels];
  const last = rest.pop();
  return `${rest.join(", ")} and ${last}`;
}

/**
 * Body copy for a node failure that carries the upstream's HTTP status.
 *
 * `meta.upstreamStatus` is attached by `nodeErrorDomain.ts` for every node
 * code that can have one, precisely so these entries can use it. A status is
 * the one detail that changes what the customer should do: 401/403 is a key
 * they can fix, 429 is a wait, 5xx is the other service's problem. Naming the
 * number without the vocabulary around it keeps it useful without turning the
 * toast into a stack trace.
 */
function describeUpstreamStatus({
  error,
  whenAbsent,
  whenOther,
  whenRejected = "Check the credentials for that service, then try again.",
}: {
  error: HandledErrorShape;
  /** No status on the error at all — we know nothing more than the code. */
  whenAbsent: string;
  /** A 4xx that isn't about credentials or rate limits. */
  whenOther: string;
  /** 401/403: something we sent was refused. */
  whenRejected?: string;
}): string {
  const status = error.meta.upstreamStatus;
  if (typeof status !== "number") return whenAbsent;
  if (status === 401 || status === 403) return whenRejected;
  if (status === 429) return "It's rate limiting us. Try again shortly.";
  if (status >= 500) return "It's having trouble. Try again in a moment.";
  return whenOther;
}

/**
 * Fallback headline for a failure that arrives with NO code at all.
 *
 * Only for that case. `fault` is a coarse attribution with a server-side
 * default of `customer`, so using it as a headline for an unrecognised code
 * meant a platform failure whose payload predated the field read "Check your
 * input", and a customer's own Python error read "A connected service didn't
 * respond". Confidently wrong beats nothing only if it happens to be right.
 */
const FAULT_TITLES: Record<HandledErrorFault, string> = {
  customer: "Check your input",
  platform: "Something went wrong on our end",
  provider: "A connected service didn't respond",
};

/**
 * `dataset_import_stalled` → "Dataset import stalled".
 *
 * What an unrecognised code degrades to. It is a legitimate arrival — a Go
 * service or the other half of a rolling deploy can be ahead of this client —
 * and the code is the only true thing we have about it. Shown rather than
 * hidden because the customer can quote it to support and get a real answer,
 * where "Something went wrong" ends the conversation. Clamped, because the
 * code came off the same wire as everything else here.
 */
function humanizeCode(code: string): string {
  const words = safeProse(code.replace(/_/g, " "));
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface ErrorExplanation {
  title: string;
  /** Empty when there is nothing useful to add beyond the title. */
  description: string;
  /**
   * Whether this copy was written for this specific code, or is the degraded
   * form (the humanised code, or the generic unknown state). Callers use it to
   * decide whose headline wins: registered copy describes the actual failure,
   * so it beats a caller's generic one — and the degraded form does not, since
   * a caller's "Couldn't create project" at least names the action.
   */
  isRegistered: boolean;
}

/**
 * Turns a handled error into the words a customer reads.
 *
 * Never returns a server message. An unrecognised code degrades to the code
 * itself, humanised — specific and quotable to support — rather than to a
 * fault-shaped guess at what went wrong.
 */
export function explainHandledError(
  error: HandledErrorShape,
): ErrorExplanation {
  // `hasOwn`, not a bare index: `code` is untrusted, and `"toString"` or
  // `"constructor"` would otherwise resolve to an inherited Object.prototype
  // member — truthy, so it would report itself registered and render a blank
  // headline.
  const presentation = Object.hasOwn(presentations, error.code)
    ? (presentations as Record<string, ErrorPresentation>)[error.code]
    : undefined;

  if (!presentation) {
    // Fault only when the code is missing or is nothing but whitespace — the
    // one case where there is genuinely nothing specific to say.
    const humanized = humanizeCode(error.code);
    return {
      title:
        humanized ||
        FAULT_TITLES[error.fault] ||
        UNKNOWN_ERROR_PRESENTATION.title,
      // `meta.message` is the deliberate opt-in channel for server-authored
      // prose (it mirrors Go's `Meta["message"]`). It is the only place the
      // server is allowed to put a sentence, so it is the only place we look
      // — and even here it is only a sentence's worth, because the payload
      // does not always originate with us. See `safeProse`.
      //
      // Left empty when there is none: the callers fall back to the server's
      // first remediation tip, which was written for exactly this case.
      description: safeProse(str(error, "message", "")),
      isRegistered: false,
    };
  }

  return {
    title: presentation.title,
    description: presentation.describe?.(error) ?? "",
    isRegistered: true,
  };
}

/**
 * Explains a handled error that arrived already-serialised on an event payload
 * (a `target_result.domainError`, an evaluator `domainError`) rather than off a
 * transport envelope — the coded counterpart to reading a raw `error` string.
 */
export function explainSerializedError(
  domainError: SerializedHandledError,
): ErrorExplanation {
  return explainHandledError(handledShapeFromSerialized(domainError));
}

/**
 * Explains ANY error — handled, authored, or neither.
 *
 * This is the three-way branch, in one place. It was previously inlined in
 * `showErrorToast`, `describeError` and `<HandledErrorAlert>`, and hand-copied
 * at seven more call sites — every one of which reproduced only two of the
 * three branches and so silently threw away prose a procedure had written for
 * the user. A branch that must be repeated is a branch that will be repeated
 * wrong.
 *
 * Prefer `showErrorToast` or `<HandledErrorAlert>` where you can render
 * something; reach for this when you need the title and description apart.
 */
export function explainAnyError(error: unknown): ErrorExplanation {
  const handled = readHandledError(error);
  if (handled) return explainHandledError(handled);

  const authored = readAuthoredMessage(error);
  return authored
    ? { ...UNKNOWN_ERROR_PRESENTATION, description: authored }
    : UNKNOWN_ERROR_PRESENTATION;
}

/**
 * The whole explanation as one string, for slots that can only take text —
 * a `title=` tooltip, a state field typed `string`, an aria-label.
 *
 * Prefer `HandledErrorAlert` or `showErrorToast` wherever a component can be
 * rendered: they show the remediation tips, the docs link and the error id,
 * all of which are lost here. This exists so the awkward slots have something
 * better than `error.message`, not as a general-purpose escape hatch.
 */
export function describeError({
  error,
  fallbackTitle,
}: {
  error: unknown;
  fallbackTitle?: string;
}): string {
  const explanation = explainAnyError(error);

  const title = explanation.isRegistered
    ? explanation.title
    : (fallbackTitle ?? explanation.title);

  return explanation.description
    ? `${title}. ${explanation.description}`
    : title;
}

/** Copy for a failure with no handled payload at all. See ADR-045. */
export const UNKNOWN_ERROR_PRESENTATION: ErrorExplanation = {
  title: "Something went wrong",
  description: "We've been notified. Try again in a moment.",
  isRegistered: false,
};
