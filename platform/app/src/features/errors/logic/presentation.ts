import type {
  GoErrorCode,
  HandledErrorFault,
  NodeErrorCode,
  SerializedHandledError,
  SerializedReason,
} from "@langwatch/handled-error";

import type { AppErrorCode } from "./codes";
import {
  type HandledErrorShape,
  handledShapeFromSerialized,
  readAuthoredMessageOfUnhandled,
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

/**
 * Whether any code in the error's reason chain (depth-first, nested included)
 * is one of `codes`.
 *
 * This is the ONLY way copy is allowed to vary on what an upstream said. A
 * reason code is a discriminant — a value from a set the emitter enumerates —
 * so matching one is a fact, and it selects a sentence written here. Sniffing
 * an upstream's message string instead would be both unreliable (providers
 * reword their prose) and unsafe (that string is the one carrying key
 * material). Same rule `promoteCodexAgentError` follows for Langy.
 */
const hasReasonCode = (
  reasons: readonly SerializedReason[],
  codes: ReadonlySet<string>,
): boolean =>
  reasons.some(
    (reason) =>
      codes.has(reason.code) ||
      codes.has(reason.kind) ||
      hasReasonCode(reason.reasons ?? [], codes),
  );

/**
 * The provider discriminants meaning "this account has nothing left to spend"
 * — a plan allowance, a prepaid balance, a hard billing cap.
 *
 * They share one remediation, which is why they share one sentence: retrying
 * cannot work, and the customer has to go to the provider. This is the case
 * that made reciting provider prose tempting in the first place ("Your credit
 * balance is too low" beats "try again"), and naming the discriminants is how
 * we keep that meaning without carrying the sentence that came with it.
 */
const PROVIDER_ALLOWANCE_REASONS: ReadonlySet<string> = new Set([
  "usage_limit_reached",
  "codex_plan_limit",
  "insufficient_quota",
  "billing_hard_limit_reached",
]);

/**
 * Looks a label up in one of the tables below, without trusting the key.
 *
 * Every key passed here comes from `meta` — a field name, a `fieldErrors`
 * key — so a bare index reaches `Object.prototype`: `"constructor"` resolves
 * to `Object`, which is truthy, and the copy rendered "There's a problem with
 * function Object() { [native code] }". Same hazard `explainHandledError`
 * guards `code` against, and the same fix.
 */
const label = (
  map: Record<string, string>,
  key: string,
): string | undefined => {
  if (!Object.hasOwn(map, key)) return undefined;
  const value = map[key];
  return typeof value === "string" ? value : undefined;
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
  governed_sql_unparseable: {
    title: "This query couldn't be read",
    describe: () => "Check the SQL syntax and try again.",
  },
  governed_sql_not_permitted: {
    title: "This query isn't allowed here",
    describe: () =>
      "This endpoint runs one read-only SELECT over the analytics datasets. Remove anything else and try again.",
  },
  governed_sql_parameter_missing: {
    title: "This query is missing a value",
    describe: () =>
      "The query declares parameters that weren't given values. Supply one for each and try again.",
  },
  governed_sql_not_enabled: {
    title: "Custom SQL isn't switched on here",
    describe: () =>
      "This project doesn't have the SQL workbench enabled yet. Ask your administrator to switch it on.",
  },
  saved_workbench_chart_not_found: {
    title: "That saved chart isn't here",
    describe: () =>
      "It may have been deleted, or it belongs to another project. Check the list of saved charts.",
  },
  saved_workbench_chart_specification_refused: {
    title: "This chart specification isn't allowed",
    describe: () =>
      "The specification reads something the chart policy doesn't permit. Repair the parts it names and save again.",
  },
  saved_workbench_chart_definition_invalid: {
    title: "This saved chart can't be opened",
    describe: () =>
      "We can't read what was stored for it. Rebuild the chart in the workbench and save it again.",
  },
  governed_sql_unavailable: {
    title: "Analytics SQL isn't available here",
    describe: () =>
      "This feature isn't switched on for this workspace yet. Contact support to have it enabled.",
  },
  clickhouse_unavailable: {
    title: "Search is temporarily unavailable",
    describe: () => "We're on it. Try again in a moment.",
  },
  broadcaster_not_active: {
    title: "Live updates disconnected",
    describe: () => "Refresh the page to reconnect.",
  },

  // ---- workflows ----
  workflow_not_found: {
    title: "Workflow not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  published_workflow_version_not_found: {
    title: "That published version is missing",
    describe: () => "Publish the workflow again, then run it.",
  },
  workflow_execution_failed: {
    // fault: platform. The execution engine is our own infra, so this is an
    // incident on our side — never dressed up as something the customer
    // configured wrong. The engine's statusText stays in the server log.
    title: "The workflow couldn't run",
    describe: () => "We've been notified. Try running it again in a moment.",
  },

  // ---- agent-submitted reports ----
  agent_report_rate_limited: {
    // The reader here is usually a coding agent's operator on the CLI or MCP,
    // mid-report — so the copy says plainly that the report was not filed and
    // that waiting fixes it.
    title: "Too many reports just now",
    describe: () =>
      "This one wasn't sent. Wait a few minutes, then report it again.",
  },

  // ---- evaluations & experiments ----
  evaluation_not_found: { title: "Evaluation not found" },
  monitor_evaluator_required: {
    title: "This evaluation needs an evaluator",
    describe: () =>
      "Pick an existing evaluator or create one first, then attach it to the evaluation.",
  },
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
      const field = label(EVALUATOR_FIELD_LABELS, str(error, "field", ""));
      return field
        ? `Map a value to ${field} before running this evaluator.`
        : "Map all of its required fields before running it.";
    },
  },
  evaluator_input_too_large: {
    title: "That's too much text for this evaluator",
    describe: () => "Shorten the input and try again.",
  },
  experiment_not_found: {
    title: "Experiment not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  invalid_experiment_configuration: {
    // fault: platform. The saved workbench state stopped matching its schema,
    // which nobody typed and nobody can repair through the API — so the copy
    // does not ask the customer to check their input.
    title: "This experiment can't be read",
    describe: () =>
      "Its saved setup couldn't be loaded. Open it in the workbench and save it again, or contact support.",
  },
  run_not_found: {
    title: "Run not found",
    // Covers "never existed", "belongs to another project" and "its experiment
    // was archived" alike — the caller can act on all three the same way, and
    // distinguishing them out loud would confirm which run ids exist.
    //
    // The retention line is the actionable half: a run polled more than a day
    // after it finished is gone from the status cache rather than missing, and
    // the results endpoint can still find it given the experiment slug.
    describe: () =>
      "It may have been archived, or it finished long enough ago that its status is no longer cached. Results stay available from its experiment.",
  },
  dspy_step_not_found: {
    title: "Optimization step not found",
    describe: () =>
      "It may have been removed along with its run. Reload to see the current steps.",
  },
  prompt_not_found: {
    title: "Prompt not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
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

  // ==========================================================================
  // Avatar upload. One set of codes for both halves of the same check: the
  // browser rejects the file before it is ever encoded (`processAvatarImage`)
  // and the server rejects the payload as a backstop (`parseAvatarDataUrl`).
  // The customer is doing one thing — picking a photo — so they read one
  // sentence per outcome, whichever side caught it.
  // ==========================================================================
  avatar_image_unreadable: {
    // Covers "not an image", a decode failure, zero bytes, and bytes whose
    // signature contradicts the declared type. All four are one action for the
    // customer; `meta.reason` keeps them apart for logs and tests.
    title: "That file isn't a usable image",
    describe: () => "Pick a different photo and try again.",
  },
  avatar_image_too_large: {
    title: "That photo is too large",
    describe: (error) => {
      const maxBytes = error.meta.maxBytes;
      return typeof maxBytes === "number"
        ? `Pick one under ${Math.round(maxBytes / 1024 / 1024)} MB.`
        : "Pick a smaller one.";
    },
  },
  avatar_image_type_unsupported: {
    title: "That image type isn't supported",
    describe: (error) => {
      // `meta.allowed` is our own list of media types, not customer input —
      // rendered as the extensions someone recognises rather than as MIME.
      const allowed = error.meta.allowed;
      const names = Array.isArray(allowed)
        ? allowed
            .filter((type): type is string => typeof type === "string")
            .map((type) => type.replace(/^image\//, "").toUpperCase())
        : [];
      return names.length > 0
        ? `Use ${listLabels(names)}.`
        : "Use a PNG, JPEG, WebP or GIF.";
    },
  },
  avatar_rate_limited: {
    title: "Too many photo changes just now",
    describe: () => "Wait a few minutes, then upload a new one.",
  },
  avatar_image_processing_failed: {
    // The browser's canvas failed, not the file. A different photo usually
    // won't help, so the advice is to try elsewhere.
    title: "Your browser couldn't prepare that photo",
    describe: () => "Try another browser, or a different image.",
  },

  // ---- model providers (Codex / OpenAI account) ----
  codex_auth_failed: {
    // Raised while connecting or refreshing "Sign in with your OpenAI account"
    // (CodexAuthError). fault is provider — the failure is on OpenAI's side or
    // in the sign-in round trip, not the customer's input — so the copy points
    // at retrying the connection rather than fixing a field.
    title: "OpenAI sign-in didn't go through",
    describe: () =>
      "Codex couldn't reach or verify your OpenAI account. Connect it again to continue.",
  },

  model_provider_anchor_required: {
    // Reader is an API/SDK caller (or our own form) that omitted the handle
    // saying WHERE to act. `meta.requires` narrows it: deleting by provider
    // name is the legacy project-shaped contract, so only a project will do.
    // The title has to hold for BOTH branches below: only one of them is
    // about a project, and the other offers an organization instead.
    title: "Choose where this applies",
    describe: (error) =>
      str(error, "requires", "") === "project"
        ? "Removing a provider by name needs a project. Pick one and try again."
        : "Choose a project or an organization, then try again.",
  },
  model_provider_scopes_required: {
    title: "Choose where this provider applies",
    describe: () =>
      "A provider added outside a project needs at least one scope, so pick the teams or projects it covers.",
  },
  missing_provider: {
    // fault: customer — a configuration choice they can change, so the copy
    // names it rather than apologising.
    //
    // Relayed: the analysis side answers with this when the model behind the
    // request has no provider it can use for the job. Distinct from
    // `no_provider_configured`, which means nothing is connected at all —
    // here something is, and it is the wrong thing.
    title: "This model's provider can't be used here",
    describe: () =>
      "Pick a different default model in your project's model settings, then try again.",
  },
  model_not_configured: {
    // Distinct from `no_provider_configured` (nothing connected at all) and
    // from `llm_model_not_set` (a workflow node with an empty field): here a
    // provider exists but nothing has chosen which model to use.
    title: "Choose a model first",
    describe: () =>
      "Nothing has a model set yet. Pick one in your project's model settings, then try again.",
  },
  model_provider_disabled: {
    title: "This model provider is turned off",
    describe: () =>
      "Turn it back on in your project's model settings, or pick a different provider.",
  },
  model_provider_scope_forbidden: {
    // Deliberate refusal, not a mistake to correct: the provider is managed
    // above where this person can act, so the copy points at who can.
    title: "You can't change this provider here",
    describe: () =>
      "It's managed outside this project. Ask an admin on your team to change it.",
  },
  model_provider_not_found: {
    // Also covers "exists but not in your scopes" — the service answers the
    // same either way on purpose, so the copy must not imply the row is gone
    // when it may simply not be yours.
    title: "Model provider not found",
    describe: () =>
      "It may have been removed, or it isn't available here. Reload to see the current list.",
  },
  provider_key_invalid: {
    // The provider positively identified the credential as wrong, which is the
    // one refusal a new key actually fixes. Deliberately says nothing about
    // WHY beyond that — the provider's own sentence quotes the request back,
    // and for Gemini the request carries the key in its query string.
    title: "That API key was refused",
    describe: () =>
      "The provider didn't recognise it. Check you copied the whole key, and that it belongs to the right account.",
  },
  provider_key_missing: {
    title: "No API key to check",
    describe: () =>
      "Nothing is stored for this provider yet. Enter a key, then try again.",
  },
  provider_key_restricted: {
    // fault: customer, and fixable — but never by minting a new key, which is
    // what "invalid" would send them off to do. The reason is a discriminant
    // from a set Google enumerates, so branching copy on it is safe.
    title: "This key's restrictions block the request",
    describe: (error) =>
      error.meta.reason === "API_KEY_SERVICE_BLOCKED"
        ? "Its API restrictions exclude the Generative Language API. Allow that API in the Google Cloud console, or set up a Vertex AI provider instead."
        : "Its application restrictions don't allow a call from our servers. Adjust them in the Google Cloud console, then try again.",
  },
  provider_refused: {
    // fault: provider. It answered and said no, but not in terms we can map —
    // a 429 or a 503 is theirs to fix, so the copy must not send the customer
    // hunting through their own key settings.
    title: "The provider refused the check",
    describe: () =>
      "It answered, but wouldn't confirm the key. This is usually temporary — try again in a moment.",
  },
  provider_service_disabled: {
    // The single most useful thing this whole flow says: the key is fine, the
    // API is switched off for its project. Reported as "invalid API key"
    // before, which sent Google Cloud customers to mint key after key.
    title: "That API isn't enabled for this key",
    describe: () =>
      "The key works, but its Google Cloud project doesn't have the Generative Language API turned on. Enable it in the console, or set up a Vertex AI provider, which uses service-account credentials.",
  },
  provider_unreachable: {
    // fault: provider. Nothing answered the credential check, so this says
    // nothing about whether the key is good — the copy must not read as a
    // refusal. `meta.hasConfigurableEndpoint` is the one thing that changes
    // the advice: only some providers have a base URL the customer can mistype.
    title: "Couldn't reach the provider",
    describe: (error) =>
      error.meta.hasConfigurableEndpoint === true
        ? "Nothing answered, so this API key was not checked. Check your network connection, and check the base URL is correct and reachable."
        : "Nothing answered, so this API key was not checked. Check your network connection, then try again.",
  },

  // ---- access, org & limits ----
  project_not_found: {
    title: "Project not found",
    describe: () =>
      "It may have been deleted, or it isn't shared with you. Reload to see the projects you can open.",
  },
  organization_not_found_for_team: {
    title: "Organization not found",
    describe: () =>
      "This team isn't attached to an organization you can see. Reload to see the current list.",
  },
  organization_not_found: {
    title: "Organization not found",
    describe: () =>
      "It may have been deleted, or it isn't shared with you. Reload to see the ones you can open.",
  },
  no_admin_configured: {
    // fault: platform. Nobody using the app can fix this — an administrator
    // has to exist before the action is possible — so the copy names who to
    // go to rather than offering a retry that cannot work.
    title: "No administrator is set up",
    describe: () =>
      "Ask whoever set up LangWatch here to add one, then try again.",
  },
  license_key_invalid: {
    title: "That license key isn't valid",
    describe: () =>
      "Check the key you pasted, or ask your account team for a new one.",
  },
  license_expired: {
    title: "Your license has expired",
    describe: () => "Renew it to carry on, or talk to your account team.",
  },
  license_signing_key_not_pem: {
    title: "That doesn't look like a private key",
    describe: () => "Paste the whole key, including its BEGIN and END lines.",
  },
  license_signing_key_encrypted: {
    title: "That private key is passphrase-protected",
    describe: () => "Use an unencrypted private key to sign licenses.",
  },
  license_signing_failed: {
    title: "That private key couldn't sign the license",
    describe: () =>
      "Check it is the license signing key and was copied in full.",
  },
  malformed_custom_role_permissions: {
    title: "This role's permissions are invalid",
    describe: () => "Edit the role and save it again.",
  },
  custom_role_not_found: {
    title: "Custom role not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  team_not_found: {
    title: "Team not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  team_membership_not_found: {
    title: "That person isn't on this team",
    describe: () =>
      "They may have been removed since this page loaded. Reload to see who's on it.",
  },
  lite_member_restricted: {
    title: "Your account doesn't include this",
    describe: () => "Ask an admin on your team to upgrade your access.",
  },
  already_organization_member: {
    // An invite form takes several addresses at once, so the address has to be
    // in the sentence — "one of these is already a member" is not an answer.
    title: "They're already on your team",
    describe: (error) => {
      const email = str(error, "email", "");
      return email
        ? `${email} is already a member. Change their role from the members list instead.`
        : "Change their role from the members list instead.";
    },
  },
  project_permission_denied: {
    // Names the permission when the server sent one: "ask an admin for access"
    // is an errand with no address, whereas "ask an admin for `datasets:manage`"
    // is a message they can forward as-is.
    title: "You don't have access to this",
    describe: (error) => {
      const permission = str(error, "permission", "");
      return permission
        ? `Ask an organization admin to grant you "${permission}" on this project.`
        : "Ask an organization admin to grant you access to this project.";
    },
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
    // The old line restated the title in HTTP vocabulary and left the reader
    // with nothing to do. A mismatched payload shape is almost always an old
    // SDK, so say that.
    describe: () =>
      "Update the LangWatch browser SDK to the latest version, then try again.",
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
  // ---- REST API credentials ----
  // Raised by the organization-scoped REST boundary, which an integration
  // calls with an API key rather than a session. The copy points at the key
  // because that is the only thing the caller can fix.
  missing_credentials: {
    title: "This request carried no API key",
    describe: () =>
      "Send an organization API key as Authorization: Bearer <api-key>.",
  },
  invalid_credentials: {
    title: "That API key was not accepted",
    describe: () =>
      "Organization endpoints need an admin API key from Settings > API Keys. A project key cannot be used here.",
  },
  scenario_run_export_unauthenticated: {
    title: "Log in to export simulation runs",
    describe: () =>
      "Your session has expired. Log in and try the export again.",
  },
  scenario_run_export_forbidden: {
    title: "You can't export this project's simulation runs",
    describe: () => "Ask an admin for access to simulations on this project.",
  },
  // ---- billing ----
  billing_customer_email_required: {
    title: "Add a billing email first",
    describe: () =>
      "Billing needs an email address on the account before this can go through.",
  },
  billing_plan_price_missing: {
    // fault: platform. The plan the customer picked has no price set up on our
    // side, so there is nothing for them to correct — and telling them to
    // "check their input" would send them hunting for a field that isn't wrong.
    title: "This plan isn't ready to buy yet",
    describe: () =>
      "We've been notified. Contact support if you need it sooner.",
  },
  billing_currency_unsupported: {
    // Account state, not an outage, and not fixable from the UI: the account is
    // locked to a currency we don't price plans in, so retrying never helps.
    title: "This plan isn't available in your billing currency",
    describe: () => "Contact support and we'll get you onto the right plan.",
  },
  billing_customer_deleted: {
    // fault: platform. Our stored billing profile points at a record the
    // provider has deleted. Nothing the customer can do, and retrying is not
    // it — recovery is an operator action.
    title: "This account's billing profile isn't active",
    describe: () => "We've been notified. Contact support to get set back up.",
  },
  billing_provider_unavailable: {
    // fault: provider. Only raised for rate limiting or an unreachable
    // provider, so waiting genuinely is the action — and nothing happened,
    // which is the first thing anyone wants to know.
    title: "Billing is busy right now",
    describe: () => "Nothing was charged. Try again in a moment.",
  },
  seat_billing_unavailable: {
    // fault: provider. The payment provider didn't answer. Nothing was
    // charged, and saying so is the first thing anyone wants to know.
    title: "Seat billing is unavailable right now",
    describe: () => "Nothing was charged. Try again in a moment.",
  },
  subscription_sync_failed: {
    // fault: platform. Our copy of the plan is behind the payment provider's;
    // it usually catches up on its own, so the action is to wait and reload.
    title: "Your plan details are out of date",
    describe: () =>
      "We've been notified, and this usually catches up on its own. Reload in a few minutes.",
  },
  usage_report_failed: {
    // fault: platform. Reporting usage is ours to get right.
    title: "Couldn't build that usage report",
    describe: () => "We've been notified. Try again in a moment.",
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
  ingestion_source_cap_reached: {
    title: "You've hit the limit for ingestion sources",
    describe: () =>
      "Archive one you no longer use, or upgrade your plan to raise the limit.",
  },

  // ---- datasets ----
  dataset_name_taken: {
    title: "That name is taken",
    describe: () => "Pick a different name for this dataset.",
  },
  dataset_column_type_change_unsupported: {
    // Customer fault in the ADR-045 sense: they asked for something the format
    // can't do, and there is a way to get where they were going.
    title: "That column's type can't be changed",
    describe: () =>
      "Add a new column with the type you need, then move the values across.",
  },
  dataset_not_ready: {
    // A state, not a breakage — the rows are still being prepared. Waiting is
    // a real action, so this is not the "we've been notified" shape.
    title: "This dataset isn't ready yet",
    describe: () => "It's still being prepared. Wait a moment, then try again.",
  },
  dataset_stale_columns: {
    title: "This dataset's columns have changed",
    describe: () =>
      "Reload to pick up the current columns, then make your change again.",
  },
  export_failed: {
    // fault: platform. The export ran on our side and did not finish, so the
    // copy has to say nothing was changed — an export that half-worked is the
    // thing a customer will assume otherwise.
    title: "That export didn't finish",
    describe: () =>
      "Nothing was changed. Try again, or export a smaller slice.",
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
  suite_not_found: {
    title: "Run plan not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
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
  template_not_found: {
    title: "Template not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  template_immutable: {
    // A refusal by design, so no retry is offered — only the way around it.
    title: "This template can't be edited",
    describe: () =>
      "It's one of the built-in ones. Duplicate it, then edit your copy.",
  },
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
    // The one registry entry that prefers the server's words to its own — and
    // they are still OUR words. `explainSlackPostError` is a switch over the
    // Slack error codes we recognise that returns a sentence written here, in
    // this repo, for that code ("the bot isn't in that channel. Invite it with
    // /invite @LangWatch"); Slack's own prose never reaches `customerMessage`,
    // and an unrecognised code returns null so this falls through to the line
    // below. Structured error for a known cause, in other words, authored the
    // same as every other entry — it just happens to be authored next to the
    // delivery adapter, which is the only place that knows the code list.
    //
    // Clamped like any server-authored sentence; nothing to scrub, because
    // nothing here originated with the provider.
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
  langy_rate_limited: {
    // Raised when someone sends faster than their own Langy allowance. The
    // message never reached Langy, so the copy says so and gives the one
    // action that works: wait.
    title: "Too many messages just now",
    describe: () =>
      "That one wasn't sent. Wait a few seconds, then send it again.",
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
    // When the provider's own sentence was captured, Langy's card replaces
    // this line with it (`langyErrorExplainer`) — an out-of-credits account
    // needs that sentence, not this one. This is the copy for when there is
    // nothing more specific to say.
    describe: () =>
      "Langy hit an error while writing this reply. Your message is safe — try again.",
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
    // "Worker" is ours, not the customer's — see `copywriting.md`. The
    // neighbouring `langy_worker_spawn_failed` already proves the same fact
    // can be told without it.
    title: "Langy stopped mid-reply",
    describe: () =>
      "Langy stopped before it could finish. Nothing you did is wrong and your message is safe, so try again.",
  },
  langy_worker_spawn_failed: {
    title: "Langy couldn't start up",
    describe: () =>
      "Langy failed to get going for this reply. Nothing was lost, so try again in a moment.",
  },
  langy_credential_resolution: {
    // One of three codes that all used to read "Couldn't verify your access"
    // while giving contradictory advice. The headline has to agree with the
    // remediation, or the customer picks the wrong one of the three: this is
    // the only one a fresh sign-in fixes.
    title: "Your sign-in needs refreshing",
    describe: () => "Sign out and back in, then try again.",
  },
  langy_model_not_configured: {
    title: "Choose a model for Langy",
    describe: () =>
      "Langy needs a model to run. Pick one in your project's model settings, then try again.",
  },
  langy_codex_plan_limit: {
    // fault: provider. The limit belongs to the customer's OpenAI plan, not to
    // anything LangWatch meters — so the copy must not read like our own
    // `resource_limit_exceeded`, whose fix is upgrading with us.
    title: "You've reached your OpenAI plan's limit",
    describe: () =>
      "Codex runs on your OpenAI account, and it has no allowance left for now. Wait for it to reset, or raise the limit with OpenAI.",
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

  // ---- AI-assisted features ----
  ai_call_failed: {
    // fault: provider. The model was asked and didn't answer usably. Switching
    // model is the action that actually changes the outcome; "we've been
    // notified" would be both wrong and useless here.
    title: "That model call didn't go through",
    describe: () => "Try again in a moment, or pick a different model.",
  },
  ai_query_provider_error: {
    // fault: provider. Same shape as above, but the reader is mid-search, so
    // rephrasing is the first thing worth trying.
    title: "Couldn't turn that into a search",
    describe: () =>
      "The model didn't return something we could use. Rephrase it, or pick a different model.",
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
          .map((field) => label(USER_VISIBLE_FIELDS, field))
          .filter((entry): entry is string => !!entry);
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
      const field = label(USER_VISIBLE_FIELDS, str(error, "field", ""));
      return field
        ? `There's a problem with ${field}.`
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
  codex_session_expired: {
    // The gateway's own code for a dead Codex OAuth session (401). Langy has a
    // richer inline card for the same failure (`langy_codex_session_expired`
    // with a "Sign in to Codex" action); this is the plain registry copy for
    // when the gateway proxies the code to any other surface.
    title: "Your OpenAI session expired",
    describe: () =>
      "Codex runs on your OpenAI account, and its sign-in has expired. Sign in again to keep using it.",
  },
  budget_exceeded: {
    title: "You've reached your spending limit",
    describe: () => "Raise the limit in settings to keep going.",
  },
  end_user_required: {
    title: "This key needs a user on every request",
    describe: () =>
      "Send the OpenAI user field or the X-LangWatch-End-User-Id header.",
  },
  virtual_key_disabled: {
    title: "This key is disabled",
    describe: () =>
      "An administrator can re-enable it; the key itself is unchanged.",
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
  guardrail_upstream_unavailable: {
    // 503 from the guardrail evaluator itself, not a policy decision: the
    // request was neither allowed nor blocked, so the copy must not imply the
    // customer's content was refused.
    title: "Guardrails are temporarily unavailable",
    describe: () => "This request wasn't checked. Try again in a moment.",
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
    // 503: the check itself didn't run. Nothing is wrong with the account, so
    // the copy must not read like a credential problem — the customer would
    // go and rotate a perfectly good key.
    title: "Access checks are temporarily unavailable",
    describe: () => "Nothing changed on your account. Try again in a moment.",
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
  virtual_key_not_found: {
    title: "Virtual key not found",
    describe: () =>
      "It may have been deleted, or it isn't shared with you. Reload to see the keys you can open.",
  },
  gateway_budget_not_found: {
    title: "Budget not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
  gateway_scope_org_mismatch: {
    // Names the KIND of scope, never the id — the id belongs to a record in
    // another organization, which is exactly what this guard refuses to
    // confirm the existence of.
    title: "That scope isn't in this organization",
    describe: (error) => {
      const scopeType = str(error, "scope_type", "");
      return scopeType
        ? `Pick a ${scopeType} that belongs to this organization.`
        : "Pick a scope that belongs to this organization.";
    },
  },
  gateway_guardrail_project_mismatch: {
    title: "That guardrail is in a different project",
    describe: () =>
      "A key can only use guardrails from its own project. Pick one from this project instead.",
  },
  gateway_spend_unavailable: {
    // fault: platform. Says what is missing, not which engine is missing it.
    title: "Spend isn't available for this key",
    describe: () =>
      "This deployment doesn't record spend per key, so there's no figure to show.",
  },
  spend_source_unavailable: {
    // The public REST spelling of the refusal above. Both doors answer the
    // same way on a deployment with no per-key spend ledger; the wire code
    // differs because the REST one is published in the management API docs
    // and callers already branch on it.
    title: "Spend isn't available for this key",
    describe: () =>
      "This deployment doesn't record spend per key, so there's no figure to show.",
  },
  webhook_event_not_found: {
    // Says the two things a caller can act on: the log's horizon, and that
    // governance events were never in it to begin with.
    title: "That event isn't in the log",
    describe: () =>
      "It may have aged out of the events log, or it may be a budget or virtual-key event, which are delivered by webhook but not retained here.",
  },
  external_id_conflict: {
    // The id is the caller's own, so naming it back is the fastest way to see
    // which of a batch of provisioning calls collided.
    title: "That external ID is already in use",
    describe: (error) => {
      const externalId = str(error, "external_id", "");
      return externalId
        ? `Another record in this organization already uses "${externalId}". Pick a different one, or update that record instead.`
        : "Another record in this organization already uses it. Pick a different one, or update that record instead.";
    },
  },
  cache_rule_not_found: {
    title: "Cache rule not found",
    describe: () => "It may have been archived by someone else.",
  },
  budget_not_found: {
    title: "Budget not found",
    describe: () => "It may have been archived by someone else.",
  },
  gateway_provider_bindings_gone: {
    // A 410 whose copy only says "gone" leaves the reader stuck. The whole
    // value of this refusal is naming where the capability moved to.
    title: "Gateway provider bindings have moved",
    describe: () =>
      "Rate limits, rotation and fallback priority now live on the model provider itself, under the Advanced (Gateway) tab.",
  },
  invalid_cursor: {
    // Restarting the walk silently would re-serve every row the caller already
    // has, so this refuses instead; the copy says what to do about it.
    title: "That page cursor isn't valid",
    describe: () =>
      "Start the list again from the beginning and follow next_cursor from there.",
  },
  gateway_group_budget_unsupported: {
    // Refusing beats creating a cap that quietly means something else, so the
    // copy says what the budget would NOT have done — that is the whole reason
    // the request was turned down.
    title: "Per-member budgets aren't available here",
    describe: () =>
      "This deployment can only cap a group's combined spend, not each member's. Set the budget on a team or project instead.",
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
    describe: () => "We've been notified. Try again in a moment.",
  },

  // ---- Langy agent ----
  llm_upstream_error: {
    // A mediated model call whose failure body was the PROVIDER's, not our
    // gateway's typed envelope.
    //
    // This entry used to recite the provider's own sentence from `meta.message`
    // on the theory that it is "client-facing by design — the same text the
    // SDK shows the caller". That reasoning has a hole big enough to drive a
    // credential through: it is client-facing to whoever OWNS the key, and on a
    // LangWatch-managed provider the caller is US. OpenAI answers a bad key
    // with `Incorrect API key provided: sk-proj-…`, so reciting that body puts
    // a PLATFORM credential on a customer's screen, and then into whatever they
    // paste into a support thread. Masking it first is not a fix — a
    // shape-matching scrubber only masks the shapes someone enumerated, and the
    // key that leaks is the one whose shape they missed.
    //
    // So the prose is gone and the discriminant does the work. The proxy
    // captures the provider's own `error.type` as a typed reason next to this
    // code (llmproxy.go), which is a value from a small known set rather than
    // free text — it cannot smuggle a key, and the ones we recognise map to
    // copy written here. Everything else gets the generic line: a failure we
    // cannot name is exactly the ADR-045 "unknown" case, and a trace id serves
    // the customer better than a sentence we cannot vouch for.
    title: "The model provider rejected that",
    describe: (error) =>
      hasReasonCode(error.reasons, PROVIDER_ALLOWANCE_REASONS)
        ? "Your account with this model provider has no allowance left. Check its billing or usage limits, or pick a model from a different provider."
        : "Try again, or pick a different model.",
  },
  agent_error: {
    title: "Something went wrong mid-answer",
    describe: () => "Try asking again.",
  },
  conversation_busy: {
    title: "Still answering",
    describe: () => "Wait for the current reply to finish.",
  },
  credentials_required: {
    // A race the platform resolves on the retry, not anything the customer
    // got wrong — so the headline says "not ready yet" rather than borrowing
    // `langy_credential_resolution`'s "verify your access", which would send
    // someone off to sign out for a failure that clears by itself.
    title: "Langy wasn't quite ready",
    describe: () => "Send that again. This usually resolves itself.",
  },
  invalid_conversation_id: {
    title: "Conversation not found",
    describe: () =>
      "This conversation link isn't one we can open. Start a new chat to keep going.",
  },
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
  not_found: {
    title: "Not found",
    describe: () => "It may have been deleted. Reload to see the current list.",
  },
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
  unsupported_parameter: {
    title: "That provider can't honor one of your parameters",
    describe: () =>
      "Remove the parameter named in the message, or pick a model that supports it.",
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
  // Fields our own forms own. Leaving these out meant every server rejection
  // on a password change, a team picker or an avatar upload degraded to the
  // anonymous "Some of the values aren't valid." — which is the one sentence
  // that cannot tell the customer where to look.
  currentPassword: "your current password",
  newPassword: "the new password",
  confirmPassword: "the confirmation",
  teamId: "the team",
  limitUsd: "the spending limit",
  imageDataUrl: "the photo",
  // Admin impersonation. The reader is a LangWatch admin, so these are the
  // words that screen uses.
  userIdToImpersonate: "the account to impersonate",
  reason: "the reason",
  resource: "the resource",
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
      // Deliberately empty, even though `meta.message` may well hold a
      // sentence.
      //
      // An unrecognised code is, by definition, the branch least able to vouch
      // for what is in that sentence: this client has no entry for the code, so
      // it does not know which service minted it, whether the prose was
      // authored for a customer, or whether it is a provider body relayed
      // through a hop we cannot see. Rendering it anyway is how an upstream's
      // words — and anything they quote — end up inside LangWatch's own error
      // chrome without a single person having read them.
      //
      // Empty is not a loss. The callers fall back to the server's first
      // remediation tip, which WAS written for this case, and failing that to
      // the generic line plus a trace id — the ADR-045 "unknown" path, working
      // exactly as intended. The fix for a code that lands here often is to
      // give it a registry entry, not to recite whatever it arrived with.
      description: "",
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
  return handled ? explainHandledError(handled) : explainUnhandledError(error);
}

/**
 * The last two branches, for a caller that has already established there is no
 * handled payload.
 *
 * Split out so `resolveErrorCopy` can reach them without re-parsing the error
 * it just parsed. Passing a handled error here would render the generic
 * unknown state over copy the registry has — use {@link explainAnyError}
 * unless you have the `null` from `readHandledError` in hand.
 */
export function explainUnhandledError(error: unknown): ErrorExplanation {
  const authored = readAuthoredMessageOfUnhandled(error);
  return authored
    ? { ...UNKNOWN_ERROR_PRESENTATION, description: authored }
    : UNKNOWN_ERROR_PRESENTATION;
}

/** Copy for a failure with no handled payload at all. See ADR-045. */
export const UNKNOWN_ERROR_PRESENTATION: ErrorExplanation = {
  title: "Something went wrong",
  description: "We've been notified. Try again in a moment.",
  isRegistered: false,
};
