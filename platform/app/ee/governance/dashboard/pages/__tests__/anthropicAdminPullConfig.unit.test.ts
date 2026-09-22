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
} from "../inventory";

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
    // An aggregate pull has no conversations to route (ADR-088 Decision 8),
    // so this stays null and the drawer offers no destination.
    traceProjectId: null,
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

  it("given an invalid report or start date, refuses to build", () => {
    const base = { credentialsToken: "sk-ant-admin-test", report: "cost" };
    expect(
      buildAnthropicAdminPullConfig(composer({ ...base, report: "both" })),
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

  it("given a bucket width it cannot honour, drops it instead of refusing", () => {
    // The form stopped asking for a width, so a refusal here would block the
    // save over a control that is not on the screen. Both of these are widths
    // the adapter would not honour as given: `2h` is not in its domain at all,
    // and on a cost report the puller sends COST_REPORT_BUCKET_WIDTH and
    // ignores the setting, so any width there was never in effect.
    const base = { credentialsToken: "sk-ant-admin-test" };

    expect(
      buildAnthropicAdminPullConfig(
        composer({ ...base, report: "usage", bucketWidth: "2h" }),
      ),
    ).toMatchObject({ bucketWidth: "1d" });

    const onCost = buildAnthropicAdminPullConfig(
      composer({ ...base, report: "cost", bucketWidth: "1h" }),
    );
    expect(onCost).not.toBeNull();
    expect(onCost).not.toHaveProperty("bucketWidth");
  });

  it("given a start date that is impossible or timezone-less, refuses to build", () => {
    const base = { credentialsToken: "sk-ant-admin-test", report: "usage" };
    // Date.parse rolls this forward to March 2 rather than failing, which would
    // backfill from a date nobody chose.
    expect(
      buildAnthropicAdminPullConfig(
        composer({ ...base, startingAt: "2026-02-30" }),
      ),
    ).toBeNull();
    // Spec'd as local time, so the same typed value means a different instant
    // for an admin in Amsterdam than one in Tokyo.
    expect(
      buildAnthropicAdminPullConfig(
        composer({ ...base, startingAt: "2026-08-01T00:00" }),
      ),
    ).toBeNull();
  });

  it("given an instant carrying a timezone, keeps it as the same moment", () => {
    const config = buildAnthropicAdminPullConfig(
      composer({
        credentialsToken: "sk-ant-admin-test",
        report: "usage",
        startingAt: "2026-08-01T02:00:00+02:00",
      }),
    );

    const parsed = anthropicAdminPullConfigSchema.parse(config);
    expect(parsed.startingAt).toBe("2026-08-01T00:00:00.000Z");
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
