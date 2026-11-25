// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { nowInstant } from "@langwatch/time";

import type { SourceType } from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";

/** The one-time secret reveal, shown after a create or a rotate. */
export type SecretDetails = {
  title: string;
  secret: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
};

/**
 * The claude_code shell export block, pre-built so admins paste once. Claude Code needs
 * the OTLP exporters plus the four light content knobs or the wire is metadata-only;
 * RAW_API_BODIES stays opt-in because it serialises every request and response (#8284).
 */
export function buildClaudeCodeEnvBlock({
  secret,
  otlpUrl,
}: {
  secret: string;
  otlpUrl: string;
}): string {
  return [
    `export CLAUDE_CODE_ENABLE_TELEMETRY=1`,
    `export OTEL_TRACES_EXPORTER=otlp`,
    `export OTEL_LOGS_EXPORTER=otlp`,
    `export OTEL_METRICS_EXPORTER=otlp`,
    `export OTEL_EXPORTER_OTLP_PROTOCOL=http/json`,
    `export OTEL_LOG_USER_PROMPTS=1`,
    `export OTEL_LOG_TOOL_DETAILS=1`,
    `export OTEL_LOG_TOOL_CONTENT=1`,
    `export OTEL_LOG_ASSISTANT_RESPONSES=1`,
    `# Upgrading? Remove any older OTEL_LOG_RAW_API_BODIES=1 line from your shell rc unless you intentionally want the full request/response JSON.`,
    `export OTEL_EXPORTER_OTLP_ENDPOINT="${otlpUrl}"`,
    `export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${secret}"`,
  ].join("\n");
}

/** One test span in OTLP JSON, stamped now so it lands in the 24h health window. */
function buildTestOtlpBody({ details }: { details: SecretDetails }): string {
  return JSON.stringify({
    resource_spans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: details.sourceName },
            },
          ],
        },
        scope_spans: [
          {
            spans: [
              {
                name: "chat.completion",
                startTimeUnixNano: `${nowInstant().epochMilliseconds}000000`,
                attributes: [
                  {
                    key: "gen_ai.usage.input_tokens",
                    value: { intValue: 120 },
                  },
                  {
                    key: "gen_ai.usage.output_tokens",
                    value: { intValue: 480 },
                  },
                  {
                    key: "gen_ai.usage.cost_usd",
                    value: { doubleValue: 0.025 },
                  },
                  {
                    key: "user.email",
                    value: { stringValue: "you@your.org" },
                  },
                  {
                    key: "gen_ai.request.model",
                    value: { stringValue: "claude-sonnet-4" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

/** POSIX single quoting: JSON escaping leaves an apostrophe in a name as is. */
function shellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * A copy-paste curl that exercises the full happy path: the body parses, the
 * attribute parser sees the canonical gen_ai.* + user.email keys, and the KPI
 * strip moves on the first event. Null for source types with no push endpoint.
 */
export function buildTestCurl({
  details,
  otlpUrl,
  webhookUrl,
  usesPushUrl,
  usesWebhookUrl,
}: {
  details: SecretDetails;
  otlpUrl: string;
  webhookUrl: string;
  usesPushUrl: boolean;
  usesWebhookUrl: boolean;
}): string | null {
  if (usesPushUrl) {
    return [
      `curl -X POST '${otlpUrl}' \\`,
      `  -H 'Authorization: Bearer ${details.secret}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d ${shellSingleQuoted(buildTestOtlpBody({ details }))}`,
    ].join("\n");
  }
  if (usesWebhookUrl) {
    return [
      `curl -X POST '${webhookUrl}' \\`,
      `  -H 'Authorization: Bearer ${details.secret}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '{"event":"test.smoke","actor":"you@your.org"}'`,
    ].join("\n");
  }
  return null;
}

/** The endpoints and source-type flags a secret reveal is rendered against. */
export function secretModalTargets(details: SecretDetails | null) {
  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://langwatch.invalid";
  return {
    otlpUrl: details ? `${baseUrl}/api/ingest/otel/${details.sourceId}` : "",
    webhookUrl: details ? `${baseUrl}/api/ingest/webhook/${details.sourceId}` : "",
    usesPushUrl:
      details?.sourceType === "otel_generic" ||
      details?.sourceType === "claude_cowork" ||
      details?.sourceType === "claude_code",
    usesWebhookUrl: details?.sourceType === "workato" || details?.sourceType === "s3_custom",
    isClaudeCode: details?.sourceType === "claude_code",
  };
}
