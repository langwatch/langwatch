// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PullResult, PullRunOptions } from "@langwatch/enterprise-governance-contract";

import type { IngestionPullDiagnosticsSink } from "../../features/ingestion-pull/services/ingestion-pull-log.service.ts";
import { REAL_VENDOR_BASES, type VendorBases } from "../../rules/vendor-bases.rules.ts";
import type { GovernanceHttpClient } from "../governance-http.channel.ts";
/**
 * Anthropic (Claude) Compliance reference puller — built on top of
 * the HttpPollingPullerAdapter with the URL + auth shape locked to
 * Anthropic's documented compliance / workspace-audit API.
 *
 * Customers enable "Anthropic Compliance" with one click + provide a
 * workspace API key. URL + headers + pagination + event-mapping are
 * frozen.
 *
 * Anthropic's compliance API shape (representative — actual endpoint
 * exact URL is documented in Anthropic's enterprise console):
 *   GET https://api.anthropic.com/v1/organizations/audit_log
 *   x-api-key: <workspace-key>
 *   anthropic-version: 2023-06-01
 *   Response: { data: [...events...], next_cursor: string | null }
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-reference.feature
 *       (same lock-the-shape pattern; openai/claude follow as ⏳ rows)
 */
import { type HttpPollingConfig, HttpPollingPullerAdapter } from "./http.polling.channel.ts";

/**
 * Locked reference config for Anthropic's compliance API. Admins
 * provide ONLY the workspace API key (via `credentials.token`); the
 * URL + auth scheme + JSON-path mapping are frozen.
 */
export const CLAUDE_COMPLIANCE_PULL_CONFIG: HttpPollingConfig = {
  adapter: "http_polling",
  url: "https://api.anthropic.com/v1/organizations/audit_log",
  method: "GET",
  headers: {
    "x-api-key": "${{credentials.token}}",
    "anthropic-version": "2023-06-01",
    Accept: "application/json",
  },
  authMode: "header_template",
  cursorJsonPath: "$.next_cursor",
  cursorQueryParam: "cursor",
  eventsJsonPath: "$.data",
  schedule: "*/15 * * * *",
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.created_at",
    actor: "$.actor.email",
    action: "$.event_type",
    target: "$.model",
    cost_usd: "$.usage.cost_usd",
    tokens_input: "$.usage.input_tokens",
    tokens_output: "$.usage.output_tokens",
    extra: {
      workspace_id: "$.workspace_id",
      ip_address: "$.actor.ip_address",
    },
  },
};

const AUDIT_LOG_PATH = "/v1/organizations/audit_log";

export class ClaudeComplianceReferencePullerAdapter extends HttpPollingPullerAdapter {
  override readonly id: string = "claude_compliance";

  private readonly pullConfig: HttpPollingConfig;

  private constructor(options: {
    http: GovernanceHttpClient;
    diagnostics?: IngestionPullDiagnosticsSink;
    vendorBases?: VendorBases;
  }) {
    super(options.http, options.diagnostics);
    this.pullConfig = {
      ...CLAUDE_COMPLIANCE_PULL_CONFIG,
      url: `${(options.vendorBases ?? REAL_VENDOR_BASES).anthropicAdmin}${AUDIT_LOG_PATH}`,
    };
  }

  static override create(options: {
    http: GovernanceHttpClient;
    diagnostics?: IngestionPullDiagnosticsSink;
    vendorBases?: VendorBases;
  }): ClaudeComplianceReferencePullerAdapter {
    return new ClaudeComplianceReferencePullerAdapter(options);
  }

  override validateConfig(_config: unknown): HttpPollingConfig {
    return this.pullConfig;
  }

  override async runOnce(options: PullRunOptions, _config: HttpPollingConfig): Promise<PullResult> {
    return super.runOnce(options, this.pullConfig);
  }
}
