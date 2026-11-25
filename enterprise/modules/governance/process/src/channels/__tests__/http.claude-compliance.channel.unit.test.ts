// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Claude compliance adapter's frozen request header resolves to the
 * workspace key an admin typed, which the form files under `credentials.token`.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

import { describe, expect, it } from "vitest";

import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";
import {
  CLAUDE_COMPLIANCE_PULL_CONFIG,
  ClaudeComplianceReferencePullerAdapter,
} from "../http/http.claude-compliance.channel.ts";

const emptyPage: GovernanceHttpResponse = {
  ok: true,
  status: 200,
  statusText: "OK",
  json: async () => ({ data: [], next_cursor: null }),
  text: async () => JSON.stringify({ data: [], next_cursor: null }),
};

class RecordingHttp implements GovernanceHttpClient {
  readonly calls: { url: string; init: Parameters<GovernanceHttpClient["fetch"]>[1] }[] = [];

  async fetch(
    url: string,
    init: Parameters<GovernanceHttpClient["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    this.calls.push({ url, init });
    return emptyPage;
  }
}

describe("ClaudeComplianceReferencePullerAdapter", () => {
  describe("given a workspace key filed under the credentials as the token", () => {
    /** @scenario "The Claude compliance workspace key reaches its adapter as the token it reads" */
    it("sends that key in the frozen x-api-key header", async () => {
      const http = new RecordingHttp();
      const adapter = ClaudeComplianceReferencePullerAdapter.create({ http });

      await adapter.runOnce(
        { cursor: null, credentials: { token: "sk-ant-workspace-key" } },
        adapter.validateConfig(CLAUDE_COMPLIANCE_PULL_CONFIG),
      );

      expect(http.calls).toHaveLength(1);
      expect(http.calls[0]?.init.headers).toMatchObject({
        "x-api-key": "sk-ant-workspace-key",
        "anthropic-version": "2023-06-01",
      });
    });
  });
});
