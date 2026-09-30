// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Every source type that asks an admin for a secret must reassemble it.
 *
 * The composer drops secret fields on purpose — they are never echoed back to
 * a client, so they cannot ride the ordinary parser-config path — and expects
 * a per-source-type builder to put them back under `credentials`. That
 * arrangement has no failure mode when a builder is missing, which is the
 * problem. The form still collects the key, the key is still dropped, the
 * source still saves, and it saves looking complete. Nothing complains until
 * every run fails for want of a credential the admin typed in weeks ago.
 *
 * It happened once during the Dataverse work and would have shipped. This is
 * the guard that catches the next one at the moment the field is added rather
 * than the first time the source runs.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 *       specs/ai-gateway/governance/ingestion-sources.feature
 *       ("Every source type that collects a secret can put it back where its
 *        adapter reads it")
 */

import { SOURCE_TYPE_OPTIONS } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import {
  buildClaudeCompliancePullConfig,
  type ComposerState,
  PARSER_FIELDS,
  SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
} from "@ee/governance/dashboard/pages/inventory";
import { CLAUDE_COMPLIANCE_PULL_CONFIG } from "@ee/governance/services/pullers/claudeCompliance.puller";
import { describe, expect, it } from "vitest";

/**
 * The population is EVERY source type whose form collects a secret, hidden
 * ones included. A type that collects a secret needs a builder to put that
 * secret back where its adapter reads it; without one the key is dropped and
 * every run sends an unresolved credential template as its header.
 *
 * The population used to be the types on offer in the picker, which made
 * hiding a type a way to leave its builder missing: that is exactly what was
 * done to `claude_compliance` (#7583), and behind that door the form went on
 * collecting a workspace key that nothing routed anywhere. Hidden types are
 * in the population now, so the door is shut. Whether a type is OFFERED is a
 * separate question, asked separately below.
 */
describe("given every source type whose form collects a secret", () => {
  const offered = SOURCE_TYPE_OPTIONS.filter((option) => !option.deprecated);
  // Retired types are the one exclusion, and it is a fact about the product
  // rather than a line in this file: what a retired type reads is gone or was
  // never worth reading, so no builder would make it deliver anything. The
  // three assertions in the first test are what keep that door from becoming
  // the old one — a live or merely-unfinished type cannot be excused through
  // it without the catalog saying something plainly false.
  const retired = new Set<string>(
    SOURCE_TYPE_OPTIONS.filter((option) => option.retired).map((o) => o.value),
  );
  const secretCollecting = SOURCE_TYPE_OPTIONS.filter(
    (option) => option.mode === "pull" && !option.retired,
  )
    .map((option) => option.value)
    .filter((value) =>
      (PARSER_FIELDS[value] ?? []).some((field) => field.secret === true),
    );

  describe("when each one is checked for a way to rebuild its pull config", () => {
    it("collects secrets on at least one source type, so the check below has work", () => {
      // The first version of this file read `option.type`, which does not exist
      // on a catalog entry — every lookup returned undefined, the list emptied,
      // and the guard passed against a codebase with a known-broken source in
      // it. A guard that cannot name what it is guarding is not one.
      expect(secretCollecting.length).toBeGreaterThan(0);
      expect(secretCollecting).toContain("anthropic_admin");
      // The self-check on widening the population past the picker: a hidden
      // type has to actually be in it, or the widening is cosmetic.
      expect(secretCollecting).toContain("claude_compliance");
      expect(offered.map((o) => o.value)).not.toContain("claude_compliance");
      // And the self-checks on the one exclusion. It names somebody, it never
      // covers a type still on offer, and it does not reach the type this
      // guard was written about.
      expect(retired.size).toBeGreaterThan(0);
      expect(offered.filter((o) => retired.has(o.value))).toEqual([]);
      expect(retired.has("claude_compliance")).toBe(false);
    });

    /** @scenario "Every source type that collects a secret can put it back where its adapter reads it" */
    it("gives every source type that collects a secret a way to reassemble it", () => {
      const withBuilder = new Set<string>(
        SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
      );

      expect(secretCollecting.filter((type) => !withBuilder.has(type))).toEqual(
        [],
      );
    });

    it("keeps the compliance type out of the picker even though it is whole again", () => {
      // Its key reaches its adapter now, so the check above covers it like
      // any other type. Whether it comes BACK to the picker is a separate
      // call — the puller behind it has never run against a live tenant —
      // and this test is what stops the fix quietly making it.
      expect(offered.map((o) => o.value)).not.toContain("claude_compliance");
      expect(
        new Set<string>(SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER).has(
          "claude_compliance",
        ),
      ).toBe(true);
    });
  });
});

/**
 * The type the guard above was written about, end to end: what the form
 * collects has to come out the other side as the credential the adapter's
 * frozen header actually reads.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       ("The Claude compliance workspace key reaches its adapter as the
 *        token it reads")
 */
describe("given a Claude compliance source with a workspace key typed in", () => {
  const WORKSPACE_KEY = "sk-ant-admin-test-key";

  function composer(parserConfig: Record<string, string>): ComposerState {
    return {
      sourceType: "claude_compliance",
      name: "Claude compliance log",
      description: "",
      parserConfig,
      ottlStatements: [],
      pullSchedule: "",
      traceProjectId: null,
    };
  }

  describe("when its pull config is assembled for saving", () => {
    /** @scenario "The Claude compliance workspace key reaches its adapter as the token it reads" */
    it("carries the key as the credentials token", () => {
      const config = buildClaudeCompliancePullConfig(
        composer({ credentialsToken: WORKSPACE_KEY }),
      );

      expect(config).not.toBeNull();
      expect((config as Record<string, unknown>).credentials).toEqual({
        token: WORKSPACE_KEY,
      });
      // The adapter is resolved by this id; the frozen config's own
      // `adapter: "http_polling"` would dispatch the generic puller instead.
      expect((config as Record<string, unknown>).adapter).toBe(
        "claude_compliance",
      );
    });

    /** @scenario "The Claude compliance workspace key reaches its adapter as the token it reads" */
    it("resolves the adapter's frozen request header to that key", () => {
      const config = buildClaudeCompliancePullConfig(
        composer({ credentialsToken: WORKSPACE_KEY }),
      ) as { credentials: { token: string } };

      // The same substitution the polling adapter does at request time. The
      // bug this pins is not a wrong value but an unsubstituted one: with the
      // key dropped on the way through, every run sent this template verbatim.
      const template = CLAUDE_COMPLIANCE_PULL_CONFIG.headers?.["x-api-key"];
      expect(template).toBe("${{credentials.token}}");
      expect(
        template?.replace("${{credentials.token}}", config.credentials.token),
      ).toBe(WORKSPACE_KEY);
    });

    /** @scenario "The Claude compliance workspace key reaches its adapter as the token it reads" */
    it("refuses to save a new source with no key at all", () => {
      // A blank key on CREATE is a source that cannot authenticate. On EDIT it
      // means "leave the stored one alone", which is why the key is omitted
      // rather than written empty — an empty one would overwrite a working
      // secret on the next save.
      expect(buildClaudeCompliancePullConfig(composer({}))).toBeNull();
      const editing = buildClaudeCompliancePullConfig(composer({}), {
        shouldRequireCredentials: false,
      });
      expect(editing).not.toBeNull();
      expect(editing).not.toHaveProperty("credentials");
    });
  });
});
