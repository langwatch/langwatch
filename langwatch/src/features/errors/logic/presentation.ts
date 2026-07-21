import type {
  GoErrorCode,
  HandledErrorFault,
} from "@langwatch/handled-error";

import type { AppErrorCode } from "./codes";
import {
  readAuthoredMessage,
  readHandledError,
  type HandledErrorShape,
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
    describe: (error) =>
      str(error, "reason", "") === "auth_failed"
        ? "Check the API key for this evaluator's model provider."
        : "Try running it again.",
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
  resource_limit_exceeded: {
    title: "You've hit a plan limit",
    describe: () => "Upgrade your plan to raise it.",
  },
  scenario_set_limit_exceeded: {
    title: "You've hit the simulation set limit",
    describe: () => "Delete an existing set, or upgrade your plan.",
  },
  subscription_service_unavailable: {
    title: "Billing is temporarily unavailable",
    describe: () => "Try again in a moment.",
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
    describe: (error) =>
      str(error, "syntaxError", "Check the template and try again."),
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
    describe: () => "Check the destination and try again.",
  },
  test_fire_unavailable: {
    title: "Nothing to test yet",
    describe: (error) =>
      `Configure the ${str(error, "channel", "destination")} first.`,
  },

  // ---- Langy ----
  langy_conversation_not_found: { title: "Conversation not found" },
  langy_conversation_not_owned: {
    title: "You don't have access to this conversation",
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
    title: "Still answering",
    describe: () => "Wait for the current reply to finish.",
  },
  langy_turn_timeout: {
    title: "That took too long",
    describe: () => "Try asking again, or break it into smaller steps.",
  },
  langy_agent_at_capacity: {
    title: "Busy right now",
    describe: () => "Try again in a moment.",
  },
  langy_agent_unavailable: {
    title: "Temporarily unavailable",
    describe: () => "Try again in a moment.",
  },
  langy_agent_errored: {
    title: "Something went wrong mid-answer",
    describe: () => "Try asking again.",
  },
  langy_agent_session_lost: {
    title: "The session was lost",
    describe: () => "Start a new message to continue.",
  },
  langy_worker_restarting: {
    title: "Restarting",
    describe: () => "Try again in a moment.",
  },
  langy_worker_stopped: {
    title: "The session stopped",
    describe: () => "Start a new message to continue.",
  },
  langy_worker_spawn_failed: {
    title: "Couldn't start a session",
    describe: () => "Try again in a moment.",
  },
  langy_credential_resolution: {
    title: "Couldn't verify your access",
    describe: () => "Sign out and back in, then try again.",
  },
  langy_model_not_configured: {
    title: "No model configured",
    describe: () => "Add a model provider in settings to continue.",
  },
  langy_model_not_allowed: {
    title: "That model isn't allowed",
    describe: () => "Pick a different model, or ask an admin to allow it.",
  },
  langy_insufficient_scope: {
    title: "Missing permissions",
    describe: () => "Reconnect and grant the requested access.",
  },
  langy_github_not_connected: {
    title: "GitHub isn't connected",
    describe: () => "Connect GitHub to continue.",
  },
  langy_github_repo_not_accessible: {
    title: "Can't reach that repository",
    describe: () => "Check that the connection has access to it.",
  },
  langy_egress_misconfigured: {
    title: "Temporarily unavailable",
    describe: () => "We're on it. Try again shortly.",
  },

  // ---- validation ----
  validation_error: {
    title: "Check your input",
    describe: (error) => {
      // Zod flattens to the INPUT SCHEMA's property names, which are wire
      // identifiers: every procedure takes a `projectId` the customer never
      // sees. Name only fields that exist on screen; the per-field detail has
      // a proper home anyway (applyHandledErrorToForm).
      const fieldErrors = error.meta.fieldErrors;
      if (fieldErrors && typeof fieldErrors === "object") {
        const named = Object.keys(fieldErrors).filter((field) =>
          USER_VISIBLE_FIELDS.has(field),
        );
        if (named.length > 0) {
          return `There's a problem with ${listFields(named)}.`;
        }
      }
      const formErrors = error.meta.formErrors;
      if (Array.isArray(formErrors)) {
        const first = formErrors.find(
          (entry): entry is string => typeof entry === "string",
        );
        if (first) return first;
      }
      return "Some of the values aren't valid.";
    },
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
    describe: () => "Try again in a moment.",
  },
  ssrf_blocked: {
    title: "That address isn't allowed",
    describe: () => "Use a public URL that isn't on an internal network.",
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
} satisfies Record<AppErrorCode | GoErrorCode, ErrorPresentation>;

/**
 * Field names a customer can actually see and act on.
 *
 * Anything not here is a wire identifier — `projectId`, `organizationId`,
 * `checkId` — and naming it in a toast is the same leak as showing a code
 * slug, just via `meta` instead of `message`.
 */
const EVALUATOR_FIELD_LABELS: Record<string, string> = {
  candidate_a_id: "Variant A",
  candidate_b_id: "Variant B",
  input: "the input",
  output: "the output",
  expected_output: "the expected output",
  contexts: "the contexts",
};

const USER_VISIBLE_FIELDS = new Set([
  "name",
  "slug",
  "email",
  "description",
  "url",
  "prompt",
  "model",
  "value",
  "label",
  "title",
]);

/** Joins field names into "a", "a and b", "a, b and c". */
function listFields(fields: string[]): string {
  if (fields.length === 1) return `"${fields[0]}"`;
  const quoted = fields.map((field) => `"${field}"`);
  const last = quoted.pop();
  return `${quoted.join(", ")} and ${last}`;
}

/**
 * Fallback headline for a code with no registered copy.
 *
 * A code can arrive here legitimately: a Go service or a rolling deploy can be
 * ahead of this client. Falling back on `fault` keeps the tone right — the
 * customer is told whether this is theirs to fix or ours, which is the only
 * thing we actually know.
 */
const FAULT_TITLES: Record<HandledErrorFault, string> = {
  customer: "Check your input",
  platform: "Something went wrong on our end",
  provider: "A connected service didn't respond",
};

export interface ErrorExplanation {
  title: string;
  /** Empty when there is nothing useful to add beyond the title. */
  description: string;
  /**
   * Whether this copy was written for this specific code, or fell back to
   * `fault`. Callers use it to decide whose headline wins: registered copy
   * describes the actual failure, so it beats a caller's generic one.
   */
  isRegistered: boolean;
}

/**
 * Turns a handled error into the words a customer reads.
 *
 * Never returns a code slug or a server message — an unrecognised code
 * degrades to fault-based copy, which is calm and true rather than precise.
 */
export function explainHandledError(error: HandledErrorShape): ErrorExplanation {
  // `hasOwn`, not a bare index: `code` is untrusted, and `"toString"` or
  // `"constructor"` would otherwise resolve to an inherited Object.prototype
  // member — truthy, so it would report itself registered and render a blank
  // headline instead of degrading on fault.
  const presentation = Object.hasOwn(presentations, error.code)
    ? (presentations as Record<string, ErrorPresentation>)[error.code]
    : undefined;

  if (!presentation) {
    return {
      title: FAULT_TITLES[error.fault],
      // `meta.message` is the deliberate opt-in channel for server-authored
      // prose (it mirrors Go's `Meta["message"]`). It is the only place the
      // server is allowed to put a sentence, so it is the only place we look.
      description: str(error, "message", ""),
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
  const handled = readHandledError(error);
  const authored = readAuthoredMessage(error);
  const explanation = handled
    ? explainHandledError(handled)
    : authored
      ? { ...UNKNOWN_ERROR_PRESENTATION, description: authored }
      : UNKNOWN_ERROR_PRESENTATION;

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
