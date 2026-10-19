// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Every vendor call site goes to the configured base, and to the real vendor when none is set.
 * Spec: enterprise/modules/governance/specs/governance.feature
 */

import { anthropicAdminPullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { reportUrl as anthropicReportUrl } from "../../features/ingestion-pull/rules/anthropic-admin-report.rules.ts";
import { reportUrl as openAiReportUrl } from "../../features/ingestion-pull/rules/openai-admin-cost-report.rules.ts";
import { directoryUsersFirstPage } from "../../features/microsoft/rules/microsoft-graph-directory.rules.ts";
import { REAL_VENDOR_BASES, type VendorBases } from "../../rules/vendor-bases.rules.ts";
import type { GovernanceHttpClient, GovernanceHttpResponse } from "../governance-http.channel.ts";
import { HttpAdminApiUsersChannel } from "../http/http.admin-api-users.channel.ts";
import { ClaudeComplianceReferencePullerAdapter } from "../http/http.claude-compliance.channel.ts";
import { HttpCopilotStudioChannel } from "../http/http.copilot-studio.channel.ts";
import { HttpMicrosoftDirectoryChannel } from "../http/http.microsoft-directory.channel.ts";
import { HttpProviderSignInChannel } from "../http/http.provider-sign-in.channel.ts";

const SIM = "http://localhost:6970";
const configured: VendorBases = {
  openAiAdmin: `${SIM}/openai`,
  anthropicAdmin: `${SIM}/anthropic`,
  microsoftLogin: `${SIM}/microsoft-login`,
  microsoftGraph: `${SIM}/microsoft-graph`,
  databricksWorkspace: SIM,
  dataverseEnvironment: `${SIM}/dataverse`,
};

class RecordingHttp implements GovernanceHttpClient {
  readonly urls: string[] = [];
  constructor(private readonly answers: unknown[]) {}

  async fetch(url: string): Promise<GovernanceHttpResponse> {
    this.urls.push(url);
    const body = this.answers[Math.min(this.urls.length - 1, this.answers.length - 1)];
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }
}

const members = { data: [], has_more: false };

describe("the OpenAI admin API", () => {
  /** @scenario "The OpenAI admin API is reached at the configured base" */
  it("lists members and builds the cost report at the configured base", async () => {
    const http = new RecordingHttp([members]);
    await HttpAdminApiUsersChannel.create({ http, vendorBases: configured }).listOpenAiPeople({
      apiKey: "k",
    });
    expect(http.urls[0]).toMatch(new RegExp(`^${SIM}/openai/v1/organization/users`));
    expect(
      openAiReportUrl({
        startingAt: "2026-01-01T00:00:00Z",
        page: null,
        hasKeyGrouping: true,
        apiBase: configured.openAiAdmin,
      }).toString(),
    ).toMatch(new RegExp(`^${SIM}/openai/v1/organization/costs\\?`));
  });

  /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
  it("reaches api.openai.com when no base is configured", async () => {
    const http = new RecordingHttp([members]);
    await HttpAdminApiUsersChannel.create({ http }).listOpenAiPeople({ apiKey: "k" });
    expect(http.urls[0]).toMatch(/^https:\/\/api\.openai\.com\/v1\/organization\/users/);
  });
});

describe("the Anthropic admin API", () => {
  const config = anthropicAdminPullConfigSchema.parse({
    adapter: "anthropic_admin",
    report: "cost",
    startingAt: "2026-01-01T00:00:00Z",
  });

  /** @scenario "The Anthropic admin API is reached at the configured base" */
  it("lists members, reports and audits at the configured base", async () => {
    const http = new RecordingHttp([members]);
    await HttpAdminApiUsersChannel.create({ http, vendorBases: configured }).listAnthropicPeople({
      apiKey: "k",
    });
    expect(http.urls[0]).toMatch(new RegExp(`^${SIM}/anthropic/v1/organizations/users`));
    expect(
      anthropicReportUrl({
        config,
        startingAt: "2026-01-01T00:00:00Z",
        page: null,
        apiBase: configured.anthropicAdmin,
      }).toString(),
    ).toMatch(new RegExp(`^${SIM}/anthropic/v1/organizations/cost_report\\?`));
    const audit = ClaudeComplianceReferencePullerAdapter.create({
      http,
      vendorBases: configured,
    }).validateConfig(null);
    expect(audit.url).toBe(`${SIM}/anthropic/v1/organizations/audit_log`);
  });

  /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
  it("reaches api.anthropic.com when no base is configured", () => {
    const audit = ClaudeComplianceReferencePullerAdapter.create({
      http: new RecordingHttp([{}]),
    }).validateConfig(null);
    expect(audit.url).toBe("https://api.anthropic.com/v1/organizations/audit_log");
    expect(
      anthropicReportUrl({ config, startingAt: "2026-01-01T00:00:00Z", page: null }).origin,
    ).toBe("https://api.anthropic.com");
  });
});

describe("Microsoft sign-in", () => {
  const credentials = { tenantId: "tenant-1", clientId: "c", clientSecret: "s" };
  const environmentUrl = "https://org.crm.dynamics.com";

  /** @scenario "Microsoft sign-in is reached at the configured login base" */
  it("asks the configured login base for the token", async () => {
    const http = new RecordingHttp([{ access_token: "t" }]);
    await HttpProviderSignInChannel.create({
      http,
      vendorBases: configured,
    }).getEnvironmentToken({ credentials, environmentUrl });
    expect(http.urls[0]).toBe(`${SIM}/microsoft-login/tenant-1/oauth2/v2.0/token`);
  });

  /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
  it("asks login.microsoftonline.com when no base is configured", async () => {
    const http = new RecordingHttp([{ access_token: "t" }]);
    await HttpProviderSignInChannel.create({ http }).getEnvironmentToken({
      credentials,
      environmentUrl,
    });
    expect(http.urls[0]).toBe(`${REAL_VENDOR_BASES.microsoftLogin}/tenant-1/oauth2/v2.0/token`);
  });
});

describe("Microsoft Graph", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const row = { id: userId, mail: "a@example.com" };

  /** @scenario "Microsoft Graph is reached at the configured Graph base" */
  it("reads the directory and the audit log at the configured base", async () => {
    const http = new RecordingHttp([{ value: [row] }]);
    const read = await HttpMicrosoftDirectoryChannel.create({
      http,
      vendorBases: configured,
    }).readDirectory({ token: "t" });
    expect(read.ok).toBe(true);
    expect(http.urls[0]).toBe(directoryUsersFirstPage({ graphBase: configured.microsoftGraph }));
    const audit = HttpCopilotStudioChannel.create({
      http,
      vendorBases: configured,
    }).validateConfig(null);
    expect(audit.url).toBe(`${SIM}/microsoft-graph/v1.0/auditLogs/directoryAudits`);
  });

  /** @scenario "Microsoft Graph is reached at the configured Graph base" */
  it("follows a next link on the configured base and refuses one anywhere else", async () => {
    const onBase = `${SIM}/microsoft-graph/v1.0/users?$skiptoken=x`;
    const followed = new RecordingHttp([
      { value: [row], "@odata.nextLink": onBase },
      { value: [] },
    ]);
    await HttpMicrosoftDirectoryChannel.create({
      http: followed,
      vendorBases: configured,
    }).readDirectory({ token: "t" });
    expect(followed.urls).toHaveLength(2);

    const foreign = new RecordingHttp([
      { value: [row], "@odata.nextLink": "http://localhost:7000/v1.0/users" },
    ]);
    const read = await HttpMicrosoftDirectoryChannel.create({
      http: foreign,
      vendorBases: configured,
    }).readDirectory({ token: "t" });
    expect(read.ok).toBe(false);
    expect(foreign.urls).toHaveLength(1);
  });

  /** @scenario "A vendor base that is unset or blank reaches the real vendor" */
  it("reads graph.microsoft.com when no base is configured", async () => {
    const http = new RecordingHttp([{ value: [] }]);
    await HttpMicrosoftDirectoryChannel.create({ http }).readDirectory({ token: "t" });
    expect(http.urls[0]).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/users\?/);
  });
});
