// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  ANTHROPIC_ADMIN_FIELDS,
  CLAUDE_COMPLIANCE_FIELDS,
  OPENAI_ADMIN_FIELDS,
} from "./admin-api-parser-fields.ts";
import { COPILOT_STUDIO_DATAVERSE_FIELDS } from "./copilot-studio-parser-fields.ts";
import type { FieldDef } from "./parser-field-controls.ts";

export const PARSER_FIELDS: Record<SourceType, FieldDef[]> = {
  // No parser-config fields for generic OTel sources today - the
  // receiver accepts any well-formed OTLP/HTTP body. (Earlier copy
  // referenced a `LangWatchSourceType` attribute filter that the
  // normaliser doesn't actually implement; removed during bugbash so
  // the composer doesn't promise behaviour we don't ship.)
  otel_generic: [],
  // Claude Code's per-request shape is conveyed through OTTL statements
  // (parserConfig.ottlStatements), which the OttlEditor renders as its
  // own panel. No extra parser fields needed at the per-source level.
  claude_code: [],
  claude_cowork: [
    {
      key: "workspaceId",
      label: "Anthropic workspace ID",
      placeholder: "wsp_...",
      hint: "Find under Anthropic Admin Console → Workspace → Settings.",
      required: true,
    },
  ],
  workato: [
    {
      key: "sharedSecretLastFour",
      label: "Last 4 chars of the shared HMAC secret",
      placeholder: "e.g. a3f9",
      hint: "We auto-generate the HMAC secret + only store its hash. The last-4 helps you visually confirm which secret is configured upstream.",
      required: true,
    },
  ],
  copilot_studio: [
    {
      key: "tenantId",
      label: "Azure AD tenant ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
    },
    {
      key: "clientId",
      label: "App registration client ID",
      placeholder: "00000000-0000-0000-0000-000000000000",
      required: true,
    },
    {
      key: "clientSecret",
      label: "App registration client secret",
      placeholder: "(value pasted from Azure portal)",
      hint: "We hash this server-side; only the hash is persisted.",
      required: true,
      secret: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "300",
      hint: "How often to call Purview Audit. Default 300s.",
    },
  ],
  copilot_studio_dataverse: COPILOT_STUDIO_DATAVERSE_FIELDS,
  openai_compliance: [
    {
      key: "bucket",
      label: "S3 bucket name",
      placeholder: "acme-openai-compliance",
      required: true,
    },
    {
      key: "prefix",
      label: "S3 key prefix",
      placeholder: "compliance/",
      hint: "OpenAI Enterprise Compliance writes JSONL files under this prefix.",
    },
    {
      key: "roleArn",
      label: "Cross-account role ARN",
      placeholder: "arn:aws:iam::123456789012:role/LangWatchComplianceReader",
      hint: "We assume this role to read the bucket. Trust policy must allow our account.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "60",
    },
  ],
  openai_admin: OPENAI_ADMIN_FIELDS,
  claude_compliance: CLAUDE_COMPLIANCE_FIELDS,
  anthropic_admin: ANTHROPIC_ADMIN_FIELDS,
  databricks_genie: [
    {
      key: "workspaceUrl",
      label: "Workspace URL",
      placeholder: "https://adb-1234567890123456.7.azuredatabricks.net",
      required: true,
    },
    {
      // Named `credentials*` on purpose. `buildParserConfig` does not route
      // these anywhere — it DROPS every secret field, so none is ever written
      // to the plaintext part of parserConfig. Putting them back under
      // `credentials`, the ONLY subtree the server encrypts before the row
      // reaches the database, is this source type's pull-config builder's
      // job. A field named `clientId` would be dropped just the same and
      // never reach the adapter at all.
      key: "credentialsClientId",
      label: "Service principal client ID",
      placeholder: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
      hint: "The source signs in with this service principal at the start of every run. It needs Can Manage on every Genie space you want covered: read access is not enough. Databricks only returns other people's conversations to an identity that can manage the space, so a weaker one records nothing and reports no error.",
      secret: true,
    },
    {
      key: "credentialsClientSecret",
      label: "Service principal secret",
      placeholder: "dose...",
      hint: "The OAuth secret for that service principal. We encrypt this server-side.",
      secret: true,
    },
    {
      key: "credentialsToken",
      label: "Workspace token",
      placeholder: "dapi...",
      hint: "A personal access token, pasted instead of the service principal client ID and secret; when both are given, the token wins. Databricks expires these about an hour after issuing them, so a source that runs on a schedule is dead by the next morning: only use a token for a one-off backfill. It needs the same Can Manage on every Genie space. We encrypt this server-side.",
      secret: true,
      advanced: true,
    },
    {
      key: "spaceIds",
      label: "Genie space IDs (optional)",
      placeholder: "Leave empty to cover every space the credential can see",
      hint: "Comma-separated. Empty is the usual setting: every space the credential can see is covered, including spaces created later.",
      advanced: true,
    },
    {
      key: "warehouseId",
      label: "SQL warehouse ID (optional)",
      advanced: true,
      placeholder: "095eb666b2ed2762",
      hint: "Any warehouse this credential can run a query on. It is where the billing lookup itself runs, NOT the warehouse being priced, which is every warehouse the questions used. Set it to attribute the compute behind each question to the person who asked; leave it empty and questions are recorded without an amount, since the compute behind them was never read. Naming one makes every run submit a query, so a stopped warehouse is started and billed on the source's schedule. The token additionally needs SELECT on the `system` catalogue, which only a metastore admin can grant: without it questions are still recorded, without cost. The figure is a share of the hourly bill at list prices, so it is an estimate, not the invoice.",
    },
    {
      key: "readPaidGenieBill",
      label: "Also record Genie's own bill line",
      placeholder: "",
      hint: "Reads the usage Databricks bills under the Genie product itself, the per-message and inference charges, separate from the warehouse compute the questions run on, and records it per person, per day, per price line, at list price. It runs on the same SQL warehouse as the question pricing and needs the same SELECT on the `system` catalogue; with no warehouse named the read cannot start and the run says so. Off by default because most workspaces are still on Genie's free line, which this read records as usage with no amount.",
      control: "switch",
      defaultOn: false,
      // Advanced for the same reason the warehouse id beside it is: it is a
      // billing read a metastore admin has to grant, not part of getting the
      // source to record conversations at all.
      advanced: true,
    },
  ],
  s3_custom: [
    {
      key: "bucket",
      label: "S3 bucket name",
      placeholder: "acme-agent-audit",
      required: true,
    },
    {
      key: "prefix",
      label: "S3 key prefix",
      placeholder: "audit-logs/",
    },
    {
      key: "roleArn",
      label: "Cross-account role ARN",
      placeholder: "arn:aws:iam::123456789012:role/LangWatchAuditReader",
      required: true,
    },
    {
      key: "parserDsl",
      label: "Parser DSL (line → OCSF ActivityEvent mapping)",
      placeholder: "actor=$.user.email\naction=$.event_type\ntimestamp=$.ts",
      hint: "One field-mapping per line. Each maps an OCSF field to a JSONPath into the source line.",
      required: true,
    },
    {
      key: "pollEverySec",
      label: "Polling cadence (seconds)",
      placeholder: "60",
    },
  ],
  http_custom: [
    {
      key: "url",
      label: "Audit-log endpoint URL",
      placeholder: "https://api.acme.com/v1/audit-log",
      hint: "Paginated REST endpoint that returns a JSON page of events plus a next-cursor.",
      required: true,
    },
    {
      key: "authHeaderName",
      label: "Auth header name",
      placeholder: "Authorization",
      hint: "Standard bearer flow: leave as Authorization. For x-api-key style auth, paste the header name.",
      required: true,
    },
    {
      key: "authHeaderValue",
      label: "Auth header value (template)",
      placeholder: "Bearer ${{credentials.token}}",
      hint: "Use ${{credentials.token}} where the secret should be substituted at request time. The token itself is captured in the next field.",
      required: true,
    },
    {
      key: "credentialsToken",
      label: "Bearer token / API key",
      placeholder: "(value pasted from the upstream admin console)",
      hint: "Persisted server-side; only the value is held in IngestionSource.pullConfig.credentials. Substituted into the header template at request time.",
      required: true,
      secret: true,
    },
    {
      key: "eventsJsonPath",
      label: "Events array JSONPath",
      placeholder: "$.data",
      hint: "JSONPath into the response body to extract the events array (e.g. $.data, $.events, $.value).",
      required: true,
    },
    {
      key: "cursorJsonPath",
      label: "Next-cursor JSONPath",
      placeholder: "$.next_cursor",
      hint: "JSONPath to the pagination cursor in the response. Set to a path that yields null/missing when drained.",
      required: true,
    },
    {
      key: "cursorQueryParam",
      label: "Cursor query parameter name",
      placeholder: "cursor",
      hint: "Query-param name the upstream API expects on subsequent pages. Defaults to 'cursor'. Common alternatives: next_token, pageToken, $skiptoken.",
    },
    {
      key: "eventMappingDsl",
      label: "Event mapping (key=jsonpath per line)",
      placeholder:
        "source_event_id=$.id\nevent_timestamp=$.created_at\nactor=$.user.email\naction=$.event_type\ntarget=$.target.name",
      hint: "Required keys: source_event_id, event_timestamp, actor, action, target. Optional: cost_usd, tokens_input, tokens_output. Each line maps an OCSF field to a JSONPath into one event.",
      required: true,
    },
  ],
};
