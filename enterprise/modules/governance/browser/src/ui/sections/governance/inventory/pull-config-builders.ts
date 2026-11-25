// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceToaster } from "../../../../behavior/governance-feedback.ts";
import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  PULL_ADAPTER_FOR_SOURCE,
  PULL_SCHEDULE_DEFAULTS,
} from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import {
  buildAnthropicAdminPullConfig,
  buildClaudeCompliancePullConfig,
  buildOpenAiAdminPullConfig,
} from "./admin-api-pull-config.ts";
import {
  buildArdRegistryPullConfig,
  buildAwsBedrockAgentsPullConfig,
  buildGcpVertexAgentEnginePullConfig,
} from "./cloud-agent-pull-config.ts";
import {
  buildCopilotStudioDataversePullConfig,
  copilotStudioRefusalCopy,
} from "./copilot-studio-pull-config.ts";
import { switchFieldIsOn } from "./parser-field-controls.ts";
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
  "aws_bedrock_agents",
  "gcp_vertex_agent_engine",
  "ard_registry",
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
    aws_bedrock_agents: [
      () => buildAwsBedrockAgentsPullConfig(composer),
      "Missing required AWS fields",
      "Pick an AWS connection and add at least one region, such as eu-west-1.",
    ],
    gcp_vertex_agent_engine: [
      () => buildGcpVertexAgentEnginePullConfig(composer, { shouldRequireCredentials }),
      "Missing required Google Cloud fields",
      shouldRequireCredentials
        ? "Add a project and a location such as europe-west4 to each row, and paste the service account key."
        : "Add a project and a location such as europe-west4 to each row. Leave the key blank to keep the saved one.",
    ],
    ard_registry: [
      () => buildArdRegistryPullConfig(composer),
      "Missing registry address",
      "The registry's domain or https address is required.",
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
