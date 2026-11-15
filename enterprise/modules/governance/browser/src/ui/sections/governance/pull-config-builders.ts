// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Temporal } from "@langwatch/time";

import type { GovernanceToaster } from "../../../behavior/governance-feedback.ts";
import type { SourceType } from "../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  PULL_ADAPTER_FOR_SOURCE,
  PULL_SCHEDULE_DEFAULTS,
} from "../../../features/ingestion-sources/model/pull-cadence.ts";
import {
  ANTHROPIC_BUCKET_WIDTHS,
  azureOneAppChosen,
  READ_DIRECTORY_DEFAULT_ON,
  READ_SEATS_DEFAULT_ON,
  switchFieldIsOn,
} from "./parser-fields.ts";
import type { ComposerState } from "./source-composer-state.ts";

/**
 * The pull config the create call should carry, or `null` when the form is not
 * yet valid. Returning a wrapper rather than the bare config keeps "no pull
 * config for this source type" (a valid `{ pullConfig: null }`) distinct from
 * "the form is wrong" (`null`), which a bare return would collapse.
 */
/**
 * The source types that reassemble their own pull config.
 *
 * Exported so a test can hold it against the fields the form collects. A
 * source type with a `secret: true` field and no builder here does not fail
 * loudly: the form drops secret keys deliberately, expecting a builder to put
 * them back under `credentials`, so without one the secret is collected from
 * the admin, dropped on the way through, and the source saves looking
 * complete. Every run then fails for want of a credential the form asked for.
 *
 * The list is not `Partial`, so it and the map below cannot drift apart —
 * adding a builder without naming it here, or naming one that does not exist,
 * is a type error.
 */
export const SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER = [
  "http_custom",
  "databricks_genie",
  "copilot_studio_dataverse",
  "openai_admin",
  "anthropic_admin",
  "claude_compliance",
] as const;

type PullConfigBuilderSourceType = (typeof SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER)[number];

export function resolvePullConfig(
  composer: ComposerState,
  toaster: GovernanceToaster,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): { pullConfig: Record<string, unknown> | null } | null {
  const pullAdapter = PULL_ADAPTER_FOR_SOURCE[composer.sourceType];
  // For BYO `http_custom` we send the FULL HttpPollingConfig shape so the
  // generic adapter can run unmodified. The locked-shape reference pullers
  // (copilot_studio / openai_compliance / claude_compliance) only need the
  // adapter id - their validateConfig override returns the frozen config.
  const builders: Record<PullConfigBuilderSourceType, [() => unknown, string, string]> = {
    http_custom: [
      () => buildHttpCustomPullConfig(composer),
      "Missing required HTTP source fields",
      "URL, auth header value, token, events JSONPath, cursor JSONPath, and event mapping are all required.",
    ],
    databricks_genie: [
      () => buildDatabricksGeniePullConfig(composer),
      "Missing required Databricks fields",
      "Workspace URL is required, plus a way to sign in: either a workspace token, or a service principal's client ID and secret together.",
    ],
    copilot_studio_dataverse: [
      () => buildCopilotStudioDataversePullConfig(composer, { shouldRequireCredentials }),
      "Missing required Copilot Studio fields",
      copilotStudioRefusalCopy(composer, { shouldRequireCredentials }),
    ],
    openai_admin: [
      () => buildOpenAiAdminPullConfig(composer, { shouldRequireCredentials }),
      "Missing or invalid OpenAI fields",
      shouldRequireCredentials
        ? "An organization Admin API key is required, and the backfill start must be a calendar date (2026-08-01) or an instant carrying a timezone (2026-08-01T00:00:00Z)."
        : "The backfill start must be a calendar date (2026-08-01) or an instant carrying a timezone (2026-08-01T00:00:00Z). Leave the admin API key blank to keep the current one.",
    ],
    claude_compliance: [
      () => buildClaudeCompliancePullConfig(composer, { shouldRequireCredentials }),
      "Missing workspace API key",
      shouldRequireCredentials
        ? "The workspace API key is required: without it every run authenticates with an unresolved template."
        : "Leave the workspace API key blank to keep the current one.",
    ],
    anthropic_admin: [
      () => buildAnthropicAdminPullConfig(composer, { shouldRequireCredentials }),
      "Missing or invalid Anthropic fields",
      shouldRequireCredentials
        ? "Admin API key is required, report must be `usage` or `cost`, and the backfill start must be a calendar date (2026-08-01) or an instant carrying a timezone (2026-08-01T00:00:00Z)."
        : "Report must be `usage` or `cost`, and the backfill start must be a calendar date (2026-08-01) or an instant carrying a timezone (2026-08-01T00:00:00Z). Leave the admin API key blank to keep the current one.",
    ],
  };

  const builder = (
    builders as Partial<Record<SourceType, (typeof builders)[keyof typeof builders]>>
  )[composer.sourceType];
  if (builder) {
    const [build, title, description] = builder;
    const pullConfig = build();
    if (!pullConfig) {
      toaster.create({ title, description, type: "error" });
      return null;
    }
    return { pullConfig: pullConfig as Record<string, unknown> };
  }
  return { pullConfig: pullAdapter ? { adapter: pullAdapter } : null };
}

/**
 * Why `buildCopilotStudioDataversePullConfig` refused, in the form's own field names. The billing
 * pair is named on its own: typed without the app registration it would replace the stored
 * credentials with half of them, and a refusal naming only the registration hides why.
 */
export function copilotStudioRefusalCopy(
  c: ComposerState,
  { shouldRequireCredentials }: { shouldRequireCredentials: boolean },
): string {
  if (shouldRequireCredentials) {
    return "The environment URL is required, plus all three parts of the app registration: tenant ID, client ID and client secret.";
  }
  const p = c.parserConfig;
  if (!normalizeEnvironmentUrl(p.environmentUrl ?? "")) return "The environment URL is required.";
  const registration: readonly (readonly [string | undefined, string])[] = [
    [p.credentialsTenantId, "tenant ID"],
    [p.credentialsClientId, "client ID"],
    [p.credentialsClientSecret, "client secret"],
  ];
  const missing = registration
    .filter(([value]) => (value ?? "").trim().length === 0)
    .map(([, label]) => label);
  if (
    missing.length === registration.length &&
    Object.keys(copilotAzureBillingFrom(p).credentials).length > 0
  ) {
    return "The billing app registration client ID and secret are stored together with the app registration, so enter them with the tenant ID, client ID and client secret, or clear both billing fields to keep the current credentials.";
  }
  return `The app registration is missing its ${joinFieldLabels(missing)}. Leave the tenant ID, client ID and client secret all blank to keep the current app registration, or enter all three to replace it.`;
}

function joinFieldLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Build the full `HttpPollingConfig`-shaped pullConfig for the
 * `http_custom` BYO source-type. Maps the form's parser-config fields
 * (auth header / token / JSONPaths / mapping DSL) onto the structured
 * shape that `HttpPollingPullerAdapter.validateConfig` expects.
 *
 * Returns null when required fields are missing - the caller should
 * keep the form open + surface the missing-field state via the existing
 * required-field markers rather than fire a dispatch that the worker
 * would reject at validateConfig time.
 */
function buildHttpCustomPullConfig(c: ComposerState): Record<string, unknown> | null {
  const p = c.parserConfig;
  const url = (p.url ?? "").trim();
  const headerName = (p.authHeaderName ?? "Authorization").trim();
  const headerValue = (p.authHeaderValue ?? "").trim();
  const token = (p.credentialsToken ?? "").trim();
  const eventsPath = (p.eventsJsonPath ?? "").trim();
  const cursorPath = (p.cursorJsonPath ?? "").trim();
  const cursorParam = (p.cursorQueryParam ?? "").trim() || "cursor";
  const mappingDsl = (p.eventMappingDsl ?? "").trim();
  if (!url || !headerValue || !token) return null;
  if (!eventsPath || !cursorPath || !mappingDsl) return null;
  const eventMapping: Record<string, string> = {};
  for (const line of mappingDsl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!k || !v) continue;
    eventMapping[k] = v;
  }
  return {
    adapter: "http_polling",
    url,
    method: "GET",
    headers: { [headerName]: headerValue },
    authMode: "header_template",
    cursorJsonPath: cursorPath,
    cursorQueryParam: cursorParam,
    eventsJsonPath: eventsPath,
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.http_polling || "*/15 * * * *",
    eventMapping,
    // Per HttpPollingPullerAdapter contract: caller-supplied secrets land
    // on `pullConfig.credentials.*` and the adapter substitutes them into
    // the header template via the `${{credentials.<key>}}` syntax.
    credentials: { token },
  };
}

/**
 * The Claude Enterprise Compliance adapter config, or null when a new source
 * names no workspace API key.
 *
 * The adapter's shape is frozen — `ClaudeComplianceReferencePuller.validateConfig`
 * returns `CLAUDE_COMPLIANCE_PULL_CONFIG` whatever is stored — so the only
 * thing this builder has to get right is the credential: the frozen header
 * reads `${{credentials.token}}`, and `credentials` is the one subtree the
 * server encrypts. Everything else the form collects (the polling cadence)
 * keeps travelling through `buildParserConfig` exactly as before.
 *
 * The adapter id is written explicitly rather than copied from the frozen
 * config, which names the generic `http_polling` adapter it is built on:
 * `resolvePullAdapter` dispatches on this field, so copying it would run the
 * generic puller in place of this one. The frozen config is not imported here
 * at all — it lives in a server puller module, and pulling that into the
 * inventory page would drag the puller stack into the browser bundle.
 *
 * `shouldRequireCredentials` carries the same meaning as it does for the two
 * Admin builders below: on edit a blank key means "leave it alone", so the
 * key is OMITTED rather than emitted empty, because `updateSource` carries the
 * stored envelope across only for a key that is genuinely absent.
 *
 * NEITHER PATH REACHES THIS BUILDER TODAY. The type is `deprecated` in the
 * catalog, so the create picker never offers it, and it is absent from
 * `EDITABLE_PULL_CONFIG_SOURCE_TYPES`, so `buildEditSubmission` never asks
 * for it. The builder exists so that the day the type is offered again, the
 * secret already lands where the adapter reads it (#7583) instead of under
 * the old `workspaceApiKey` name the adapter never looked at. The coverage
 * guard in `pullConfigBuilderCoverage.unit.test.ts` is what keeps it wired.
 */
export function buildClaudeCompliancePullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const token = trimmedField(c.parserConfig, "credentialsToken");
  if (!token && shouldRequireCredentials) return null;

  return {
    adapter: "claude_compliance",
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.claude_compliance || "*/15 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/**
 * The Anthropic Admin adapter config, or null when a required field is empty
 * or `report` is not one of the two values the adapter accepts. Nothing
 * validates pullConfig against the adapter schema at save time — a bad value
 * here would sit in the row looking fine and fail on every pull — so the
 * builder is the last checkpoint before the database.
 *
 * `shouldRequireCredentials` is the one thing that differs between creating a source
 * and editing one, and it defaults to the stricter case. On create there is no
 * stored secret to fall back on, so a blank token is a broken source. On edit
 * the secret is never shown — `toDto` strips it — so a blank token means
 * "leave it alone", and the key must be OMITTED rather than emitted empty:
 * `updateSource` carries the stored envelope across only for a key that is
 * genuinely absent, so `credentials: { token: "" }` would overwrite a working
 * key with an empty one and break the source on its next run.
 *
 * Every other check stays shared. Forking a second builder for the edit form
 * is how the two paths would drift into disagreeing about which reports the
 * adapter accepts, or which start dates it can read.
 */
export function buildAnthropicAdminPullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const token = trimmedField(p, "credentialsToken");
  const report = trimmedField(p, "report").toLowerCase();
  if (!token && shouldRequireCredentials) return null;
  if (report !== "usage" && report !== "cost") return null;

  const bucketWidth = bucketWidthToStore(trimmedField(p, "bucketWidth"), report);

  const startingAt = normalizeStartingAt(trimmedField(p, "startingAt"));
  if (startingAt === null) return null;

  return {
    adapter: "anthropic_admin",
    report,
    ...(bucketWidth ? { bucketWidth } : {}),
    ...(startingAt ? { startingAt } : {}),
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.anthropic_admin || "0 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/**
 * The OpenAI Admin adapter config, or null when a required field is empty or
 * the backfill start is not a date the adapter will accept. Nothing validates
 * pullConfig against the adapter schema at save time, so the builder is the
 * last checkpoint before the database.
 *
 * There is no report to choose: the adapter pulls the cost report and only the
 * cost report, because the provider's usage surface returns nothing for spend
 * the cost surface bills. `shouldRequireCredentials` carries the same meaning
 * as it does for Anthropic above — on edit a blank key means "leave it alone",
 * so the key must be OMITTED rather than written empty.
 */
export function buildOpenAiAdminPullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const token = trimmedField(p, "credentialsToken");
  if (!token && shouldRequireCredentials) return null;

  const startingAt = normalizeStartingAt(trimmedField(p, "startingAt"));
  if (startingAt === null) return null;

  return {
    adapter: "openai_admin",
    report: "cost",
    ...(startingAt ? { startingAt } : {}),
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.openai_admin || "0 * * * *",
    ...(token ? { credentials: { token } } : {}),
  };
}

/** One composer field, trimmed, with an absent key reading as empty. */
function trimmedField(p: Record<string, string>, key: string): string {
  return (p[key] ?? "").trim();
}

/**
 * The bucket width to store, or undefined to leave the key out entirely.
 *
 * The form stopped asking, so this is the only thing deciding what happens to a
 * width a source is already holding — and it can no longer refuse one. A
 * refusal would block the save over a control that is not on the screen, which
 * on the old picker was at least a field the admin could see and correct.
 *
 * Cost drops any held width. The puller sends `COST_REPORT_BUCKET_WIDTH` and
 * deliberately ignores `config.bucketWidth`, so a width stored on a cost source
 * was never in effect and there is nothing to preserve.
 *
 * Usage keeps a width the adapter still honours, and otherwise writes daily.
 * Keeping it is what makes withdrawing the question safe: the finer widths are
 * taken off new sources, not off the sources already being read at one, and an
 * admin editing a name has not asked for a settings change. Writing `1d` rather
 * than omitting it is deliberate — the adapter defaults to daily too, but a
 * stored config that says nothing cannot be told from one saved before the
 * field existed, and this source runs daily either way.
 */
function bucketWidthToStore(raw: string, report: string): string | undefined {
  if (report !== "usage") return undefined;
  return (ANTHROPIC_BUCKET_WIDTHS as readonly string[]).includes(raw) ? raw : "1d";
}

/** Whether y-m-d is a date that exists, rather than one Date would roll forward. */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  try {
    return Temporal.PlainDate.from({ year, month, day }).toString() !== "";
  } catch {
    return false;
  }
}

/**
 * A bare `YYYY-MM-DD`, or a timestamp carrying an explicit offset. Anything else
 * is rejected rather than guessed.
 *
 * The two shapes are the ones `Date.parse` reads unambiguously. An offset-less
 * `2026-08-01T00:00` is spec'd as *local* time, so the same typed value would
 * mean a different instant for an admin in Amsterdam than one in Tokyo.
 */
const STARTING_AT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/**
 * ISO-normalizes an admin-typed backfill start for the adapter's
 * `z.string().datetime()`.
 *
 * Strict on purpose: `Date.parse` rolls `2026-02-30` forward to March 2 instead
 * of failing, which would silently backfill from a date nobody chose.
 *
 * Empty is not an error — the field is optional — so it yields undefined, while
 * anything rejected yields null for the caller to turn into a toast.
 */
function normalizeStartingAt(raw: string): string | null | undefined {
  if (!raw) return undefined;

  const match = STARTING_AT.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealCalendarDate(year, month, day)) return null;

  try {
    const instant = Temporal.Instant.from(
      /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw,
    );
    return instant.toString({ fractionalSecondDigits: 3 });
  } catch {
    return null;
  }
}

/**
 * The pullConfig for a Copilot Studio source reading Dataverse.
 *
 * All three credential fields travel in the `credentials` subtree — the only
 * part of parserConfig the server encrypts — which is why they are named
 * `credentials*`. Without this builder the composer would fall through to the
 * bare `{ adapter }` default: the form would collect a client secret,
 * `parserFieldValue` would drop it as a secret, nothing would put it back, and
 * the source would save looking complete and fail every run for want of a
 * credential it did ask for.
 */
export function buildCopilotStudioDataversePullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const p = c.parserConfig;
  const environmentUrl = normalizeEnvironmentUrl(p.environmentUrl ?? "");
  const tenantId = (p.credentialsTenantId ?? "").trim();
  const clientId = (p.credentialsClientId ?? "").trim();
  const clientSecret = (p.credentialsClientSecret ?? "").trim();
  if (!environmentUrl) return null;

  // All three or none: two thirds of an app registration is not a sign-in,
  // and accepting it would save a source that cannot run. On edit, none
  // means "keep the stored registration", so the key is omitted entirely.
  const registration = [tenantId, clientId, clientSecret];
  const isComplete = registration.every((value) => value.length > 0);
  const isBlank = registration.every((value) => value.length === 0);
  if (!isComplete && (shouldRequireCredentials || !isBlank)) return null;

  const billing = copilotAzureBillingFrom(p);
  // A billing pair typed without the registration would replace the whole
  // sealed subtree with half of it.
  if (isBlank && Object.keys(billing.credentials).length > 0) return null;
  return {
    adapter: "copilot_studio_dataverse",
    environmentUrl,
    // Empty means every agent the credential can see, which is what most
    // customers want and what covers a new agent the day someone makes one.
    botIds: (p.botIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    schedule:
      c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.copilot_studio_dataverse || "*/15 * * * *",
    ...billing.config,
    // A real boolean, because the adapter's schema is `z.boolean()` and would
    // refuse the form's string on every run. The default comes from the field
    // definition the switch renders from, so a form nobody touched saves the
    // state it was showing.
    readSeats: switchFieldIsOn({
      value: p.readSeats,
      defaultOn: READ_SEATS_DEFAULT_ON,
    }),
    // Same rule as `readSeats` above: a real boolean, from the same constant
    // the switch renders from, so an untouched form saves what it was showing.
    readDirectory: switchFieldIsOn({
      value: p.readDirectory,
      defaultOn: READ_DIRECTORY_DEFAULT_ON,
    }),
    ...(isComplete
      ? { credentials: { tenantId, clientId, clientSecret, ...billing.credentials } }
      : {}),
  };
}

/**
 * The environment address as the adapter reads it: trailing slashes dropped,
 * and `https://` put in front of a bare host name, which is how the address is
 * most often pasted. Stored without it, the source failed every pull (#9273).
 */
export function normalizeEnvironmentUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The Azure billing part of a Copilot Studio pullConfig: the subscription and
 * prepaid declaration for the config itself, and the billing identity's pair
 * for the encrypted credentials subtree.
 *
 * The subscription is omitted rather than sent empty, the same way Genie
 * omits an unset warehouse: the adapter reads "no subscription named" as "do
 * not read cost", and an empty string is a subscription id it would then ask
 * Azure about — and the schema would refuse it as not a uuid, failing the
 * save for a field the customer deliberately left blank. The prepaid flag
 * rides only beside a subscription: without a bill to read the declaration
 * has nothing to explain, and a stored `true` would spring back the day a
 * subscription is added — declared by nobody.
 *
 * The billing keys are present or absent, never empty strings, which
 * everything downstream would read as credentials. Whether the pair is
 * COMPLETE is judged server-side (`assertAzureBillHasItsOwnCredential`),
 * whose refusal names what is missing; the builder's job is only to not
 * manufacture values.
 *
 * With one app chosen (the form's default), the billing slots are COPIES of
 * the conversation pair, decided here at save time from the switch alone —
 * never from leftover billing values the form may still hold from a two-app
 * detour, which the form deliberately never clears. The choice itself is
 * written as `azureBillingUsesSameApp`, and only beside a subscription (same
 * rule as the prepaid flag): it is the only durable record — once the
 * credentials are sealed, equal-looking pairs cannot be told apart from a
 * deliberate second app with the same values.
 */
function copilotAzureBillingFrom(p: Record<string, string>): {
  config: Record<string, unknown>;
  credentials: Record<string, string>;
} {
  const azureSubscriptionId = (p.azureSubscriptionId ?? "").trim();
  const oneApp = azureOneAppChosen(p);

  const config: Record<string, unknown> = {};
  if (azureSubscriptionId) {
    config.azureSubscriptionId = azureSubscriptionId;
    config.azureBillingIsPrepaid = switchFieldIsOn({
      value: p.azureBillingIsPrepaid,
      defaultOn: false,
    });
    config.azureBillingUsesSameApp = oneApp;
  }

  return {
    config,
    credentials: copilotBillingCredentialsFrom({
      p,
      oneApp,
      hasBillToRead: azureSubscriptionId.length > 0,
    }),
  };
}

/**
 * Which values land in the billing credential slots, given the one-app
 * choice. One app: the conversation pair, and only when there is a bill to
 * read — never a speculative credential, and never the leftover billing
 * values a two-app detour may have left in form state. Two apps: what the
 * admin typed in the billing fields, exactly as before the switch existed.
 */
function copilotBillingCredentialsFrom({
  p,
  oneApp,
  hasBillToRead,
}: {
  p: Record<string, string>;
  oneApp: boolean;
  hasBillToRead: boolean;
}): Record<string, string> {
  if (oneApp && !hasBillToRead) return {};
  const source = oneApp
    ? { id: p.credentialsClientId, secret: p.credentialsClientSecret }
    : {
        id: p.credentialsBillingClientId,
        secret: p.credentialsBillingClientSecret,
      };

  const id = (source.id ?? "").trim();
  const secret = (source.secret ?? "").trim();
  const credentials: Record<string, string> = {};
  if (id) credentials.billingClientId = id;
  if (secret) credentials.billingClientSecret = secret;
  return credentials;
}

/**
 * The Databricks Genie adapter config, or null when a required field is empty.
 *
 * Genie needs a real builder rather than the bare `{ adapter }` the other
 * reference pullers get, for two reasons the form cannot express on its own:
 * the token has to land under `credentials` so the server encrypts it, and
 * `spaceIds` is a comma-separated string in the form but an array in the
 * adapter's schema.
 */
function buildDatabricksGeniePullConfig(c: ComposerState): Record<string, unknown> | null {
  const p = c.parserConfig;
  const workspaceUrl = (p.workspaceUrl ?? "").trim().replace(/\/+$/, "");
  const credentials = genieCredentialsFrom(p);
  const warehouseId = (p.warehouseId ?? "").trim();
  if (!workspaceUrl || !credentials) return null;

  return {
    adapter: "databricks_genie",
    workspaceUrl,
    // Empty means "every space the token can see", which is the setting most
    // workspaces want and the one that covers a new space automatically.
    spaceIds: (p.spaceIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.databricks_genie || "*/15 * * * *",
    // Omitted rather than sent empty: the adapter reads "no warehouse named" as
    // "do not price these questions", and an empty string is a warehouse id it
    // would then ask the workspace about.
    ...(warehouseId ? { warehouseId } : {}),
    // A real boolean, from the same constant the field declares, so what the
    // adapter reads is what the switch showed: off unless the admin turned it
    // on, never the absence of a form value read as a setting.
    readPaidGenieBill: switchFieldIsOn({
      value: p.readPaidGenieBill,
      defaultOn: false,
    }),
    credentials,
  };
}

/**
 * The credential subtree for a Genie source, holding only what was actually
 * given: an empty string is not a credential, and sending one would make the
 * adapter prefer a token that does not exist. Null when neither way of
 * signing in is complete — half of the service principal pair is not one,
 * and accepting it would save a source that cannot run.
 */
function genieCredentialsFrom(p: Record<string, string>): Record<string, string> | null {
  const token = (p.credentialsToken ?? "").trim();
  const clientId = (p.credentialsClientId ?? "").trim();
  const clientSecret = (p.credentialsClientSecret ?? "").trim();

  const credentials: Record<string, string> = {};
  if (token) credentials.token = token;
  if (clientId && clientSecret) {
    credentials.clientId = clientId;
    credentials.clientSecret = clientSecret;
  }
  return Object.keys(credentials).length > 0 ? credentials : null;
}
