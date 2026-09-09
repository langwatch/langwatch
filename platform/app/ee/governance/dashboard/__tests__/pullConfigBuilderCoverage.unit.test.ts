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
 */

import { SOURCE_TYPE_OPTIONS } from "@ee/governance/dashboard/components/ingestionSourceCatalog";
import {
  PARSER_FIELDS,
  SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
} from "@ee/governance/dashboard/pages/inventory";
import { describe, expect, it } from "vitest";

/**
 * The population is the source types an admin can actually choose. A type
 * that collects a secret needs a builder to put that secret back where its
 * adapter reads it; without one the key is dropped and every run sends an
 * unresolved credential template as its header.
 *
 * `claude_compliance` was the one type in this population with no builder
 * (#7583). It is now hidden from the picker, so it is out of the population
 * rather than exempted from it — the assertion below is what proves that,
 * and it is the reason no exemption list survives in this file. Rows already
 * configured on it are untouched and still broken; hiding stops new ones.
 */
describe("given the source types offered in the picker", () => {
  const offered = SOURCE_TYPE_OPTIONS.filter((option) => !option.deprecated);
  const secretCollecting = offered
    .filter((option) => option.mode === "pull")
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
    });

    it("gives every source type that collects a secret a way to reassemble it", () => {
      const withBuilder = new Set<string>(
        SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
      );

      expect(secretCollecting.filter((type) => !withBuilder.has(type))).toEqual(
        [],
      );
    });

    it("no longer offers the compliance type that had no builder", () => {
      // If it came back to the picker it would re-enter the population above
      // with nothing to reassemble its workspace key, so the guard would fail
      // on it rather than pass around it.
      expect(secretCollecting).not.toContain("claude_compliance");
      expect(offered.map((o) => o.value)).not.toContain("claude_compliance");
      // Its form still declares the secret, which is why it must stay hidden
      // rather than merely be left alone.
      expect(
        (PARSER_FIELDS.claude_compliance ?? []).some(
          (field) => field.secret === true,
        ),
      ).toBe(true);
      expect(
        new Set<string>(SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER).has(
          "claude_compliance",
        ),
      ).toBe(false);
    });
  });
});
