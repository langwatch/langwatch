// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Same contract as `anthropicAdminPullConfig.unit.test.ts`: whatever
 * `buildClaudeCompliancePullConfig` saves must route the workspace API
 * key into `pullConfig.credentials.token`, because the frozen puller
 * config (`CLAUDE_COMPLIANCE_PULL_CONFIG`) templates that path into the
 * `x-api-key` header. A missing credential means a literal
 * `${{credentials.token}}` hits Anthropic → 401 on every run.
 *
 * Regression test for #7168.
 */

import { describe, expect, it } from "vitest";

import {
  buildClaudeCompliancePullConfig,
  buildParserConfig,
  type ComposerState,
} from "../ingestion-sources";

function composer(
  parserConfig: Record<string, string>,
  pullSchedule = "",
): ComposerState {
  return {
    sourceType: "claude_compliance",
    name: "Anthropic compliance",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule,
  };
}

describe("buildClaudeCompliancePullConfig", () => {
  it("given a valid workspace API key, routes it to credentials.token", () => {
    const config = buildClaudeCompliancePullConfig(
      composer({ workspaceApiKey: "sk-ant-admin-test" }),
    );

    expect(config).not.toBeNull();
    expect(config).toMatchObject({
      adapter: "claude_compliance",
      credentials: { token: "sk-ant-admin-test" },
    });
  });

  it("given no workspace API key, refuses to build", () => {
    expect(buildClaudeCompliancePullConfig(composer({}))).toBeNull();
    expect(
      buildClaudeCompliancePullConfig(composer({ workspaceApiKey: "" })),
    ).toBeNull();
    expect(
      buildClaudeCompliancePullConfig(composer({ workspaceApiKey: "   " })),
    ).toBeNull();
  });

  it("keeps the secret out of the persisted parserConfig", () => {
    const state = composer({ workspaceApiKey: "sk-ant-admin-test" });
    const parser = buildParserConfig(state);
    expect(parser).not.toHaveProperty("workspaceApiKey");
  });
});
