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
 * Known broken, tracked in #7583: `claude_compliance` declares a
 * `secret: true` workspace API key and has no builder, so the key is dropped
 * and every run sends an unresolved credential template as its header. It is a
 * different source type from the one this branch adds, and fixing it here
 * would mean guessing which key its adapter reads, so it is named rather than
 * silently excluded. Deleting this entry is how that issue gets closed.
 */
const KNOWN_MISSING_BUILDER = new Set(["claude_compliance"]);

describe("given the source types offered in the picker", () => {
  const secretCollecting = SOURCE_TYPE_OPTIONS.filter(
    (option) => !option.deprecated && option.mode === "pull",
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
      expect(secretCollecting).toContain("claude_compliance");
    });

    it("gives every source type that collects a secret a way to reassemble it", () => {
      const withBuilder = new Set<string>(
        SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
      );
      const dropped = secretCollecting
        .filter((type) => !withBuilder.has(type))
        .filter((type) => !KNOWN_MISSING_BUILDER.has(type));

      expect(dropped).toEqual([]);
    });

    it("keeps the known-broken list honest, so a fix cannot leave it stale", () => {
      // A type listed as broken that has since gained a builder means the list
      // is out of date, and a stale exemption is how the guard above quietly
      // stops covering something.
      const withBuilder = new Set<string>(
        SOURCE_TYPES_WITH_PULL_CONFIG_BUILDER,
      );
      for (const type of KNOWN_MISSING_BUILDER) {
        expect(withBuilder.has(type)).toBe(false);
      }
    });
  });
});
