// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The contract between the Anthropic Admin composer form and the adapter:
 * whatever `buildAnthropicAdminPullConfig` saves must parse under
 * `anthropicAdminPullConfigSchema`, because nothing validates the pullConfig
 * at save time — the first thing that reads it is the puller worker, and a
 * shape mismatch there is a source that looked fine when it was created and
 * fails on every run. This is exactly how Genie's `spaceIds` broke once, so
 * the new source type gets the guard from day one.
 */

import { describe, expect, it } from "vitest";

import { anthropicAdminPullConfigSchema } from "../../../services/pullers/anthropicAdmin.puller";
import {
  buildAnthropicAdminPullConfig,
  buildParserConfig,
  type ComposerState,
} from "../ingestion-sources";

function composer(
  parserConfig: Record<string, string>,
  pullSchedule = "",
): ComposerState {
  return {
    sourceType: "anthropic_admin",
    name: "Anthropic org spend",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule,
  };
}

describe("buildAnthropicAdminPullConfig", () => {
  it("given the minimal valid form, produces a config the adapter schema accepts", () => {
    const config = buildAnthropicAdminPullConfig(
      composer({ credentialsToken: "sk-ant-admin-test", report: "cost" }),
    );

    expect(config).not.toBeNull();
    // z.object strips unknown keys (`credentials` rides along for the
    // worker) — the parse throwing is the failure this test exists for.
    const parsed = anthropicAdminPullConfigSchema.parse(config);
    expect(parsed.report).toBe("cost");
    expect(parsed.schedule).toBe("0 * * * *");
    expect((config as Record<string, unknown>).credentials).toEqual({
      token: "sk-ant-admin-test",
    });
  });

  it("given a bare date for startingAt, normalizes it to the ISO instant the schema demands", () => {
    const config = buildAnthropicAdminPullConfig(
      composer({
        credentialsToken: "sk-ant-admin-test",
        report: "usage",
        bucketWidth: "1h",
        startingAt: "2026-08-01",
      }),
    );

    const parsed = anthropicAdminPullConfigSchema.parse(config);
    expect(parsed.startingAt).toBe("2026-08-01T00:00:00.000Z");
    expect(parsed.bucketWidth).toBe("1h");
  });

  it("given an invalid report, bucket width, or start date, refuses to build", () => {
    const base = { credentialsToken: "sk-ant-admin-test", report: "cost" };
    expect(
      buildAnthropicAdminPullConfig(composer({ ...base, report: "both" })),
    ).toBeNull();
    expect(
      buildAnthropicAdminPullConfig(composer({ ...base, bucketWidth: "2h" })),
    ).toBeNull();
    expect(
      buildAnthropicAdminPullConfig(
        composer({ ...base, startingAt: "not-a-date" }),
      ),
    ).toBeNull();
    expect(
      buildAnthropicAdminPullConfig(composer({ report: "cost" })),
    ).toBeNull();
  });

  it("given the same form state, keeps the secret and adapter-owned fields out of parserConfig", () => {
    const state = composer({
      credentialsToken: "sk-ant-admin-test",
      report: "cost",
      bucketWidth: "1d",
      startingAt: "2026-08-01",
    });

    const parser = buildParserConfig(state);
    // The token must only travel inside pullConfig.credentials (the encrypted
    // subtree), and the owned fields must not clobber the typed pullConfig on
    // the server-side merge where parserConfig wins.
    expect(parser).not.toHaveProperty("credentialsToken");
    expect(parser).not.toHaveProperty("report");
    expect(parser).not.toHaveProperty("bucketWidth");
    expect(parser).not.toHaveProperty("startingAt");
  });
});
