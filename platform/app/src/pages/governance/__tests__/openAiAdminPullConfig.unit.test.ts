// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The contract between the OpenAI Admin composer form and the adapter:
 * whatever `buildOpenAiAdminPullConfig` saves must parse under
 * `openaiAdminPullConfigSchema`, because nothing validates the pullConfig at
 * save time — the first thing that reads it is the puller worker, and a shape
 * mismatch there is a source that looked fine when it was created and fails on
 * every run. The Anthropic sibling carries the same guard for the same reason.
 *
 * This one starts from further back: the composer's dispatch table named
 * `buildOpenAiAdminPullConfig` and the function was never written, so choosing
 * "OpenAI Admin" threw `ReferenceError` before any validation could run.
 */

import { describe, expect, it } from "vitest";

import { openaiAdminPullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { buildOpenAiAdminPullConfig, type ComposerState } from "../inventory.enterprise";

function composer(parserConfig: Record<string, string>, pullSchedule = ""): ComposerState {
  return {
    sourceType: "openai_admin",
    name: "OpenAI org spend",
    description: "",
    parserConfig,
    ottlStatements: [],
    pullSchedule,
    // An aggregate pull has no conversations to route (ADR-088 Decision 8),
    // so this stays null and the drawer offers no destination.
    traceProjectId: null,
  };
}

describe("buildOpenAiAdminPullConfig", () => {
  describe("given the minimal valid form", () => {
    it("produces a config the adapter schema accepts", () => {
      const config = buildOpenAiAdminPullConfig(composer({ credentialsToken: "sk-admin-test" }));

      expect(config).not.toBeNull();
      // z.object strips unknown keys (`credentials` rides along for the
      // worker) — the parse throwing is the failure this test exists for.
      const parsed = openaiAdminPullConfigSchema.parse(config);
      expect(parsed.adapter).toBe("openai_admin");
      // `/v1/organization/costs` is the only surface this adapter reads.
      expect(parsed.report).toBe("cost");
      expect(parsed.schedule).toBe("0 * * * *");
      expect((config as Record<string, unknown>).credentials).toEqual({
        token: "sk-admin-test",
      });
    });
  });

  describe("given a bare date for the backfill start", () => {
    it("normalizes it to the ISO instant the schema demands", () => {
      const config = buildOpenAiAdminPullConfig(
        composer({ credentialsToken: "sk-admin-test", startingAt: "2026-08-01" }),
      );

      expect(openaiAdminPullConfigSchema.parse(config).startingAt).toBe("2026-08-01T00:00:00.000Z");
    });
  });

  describe("given an operator's own schedule", () => {
    it("carries it instead of the adapter's hourly default", () => {
      const config = buildOpenAiAdminPullConfig(
        composer({ credentialsToken: "sk-admin-test" }, "*/15 * * * *"),
      );

      expect(openaiAdminPullConfigSchema.parse(config).schedule).toBe("*/15 * * * *");
    });
  });

  describe("given a start date that is not one", () => {
    it("refuses to build", () => {
      expect(
        buildOpenAiAdminPullConfig(
          composer({ credentialsToken: "sk-admin-test", startingAt: "not-a-date" }),
        ),
      ).toBeNull();
      expect(
        buildOpenAiAdminPullConfig(
          composer({ credentialsToken: "sk-admin-test", startingAt: "2026-02-30" }),
        ),
      ).toBeNull();
    });
  });

  describe("given no admin key", () => {
    it("refuses to build a new source", () => {
      expect(buildOpenAiAdminPullConfig(composer({}))).toBeNull();
    });

    /**
     * The edit path leaves the secret field blank to mean "keep the one you
     * have". Emitting `credentials: { token: "" }` would overwrite a working
     * key with an empty one, which is the failure the sibling edit-path guard
     * already pins for Anthropic.
     */
    it("builds an edit that omits the credentials key entirely", () => {
      const config = buildOpenAiAdminPullConfig(composer({}), {
        shouldRequireCredentials: false,
      });

      expect(config).not.toBeNull();
      expect(config).not.toHaveProperty("credentials");
    });
  });
});
