// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The match engine has no calendar entry of its own (ADR-128 §12).
 *
 * The engine used to be booked nightly on every governance tenant. Nothing
 * writes `DiscoveredPerson` yet, so every one of those passes read an empty
 * table, and a timer whose only observable effect is a log line is a standing
 * cost with no reader. The engine stays; the appointment goes. When the feed
 * that discovers people lands, the trigger is a call site —
 * `IdentityMatchSuggestionService.recompute` and
 * `linkProvenMatches` are exactly what a hook on that write would call.
 *
 * Two spellings, because a registration is written in two places and neither
 * quotes the other: the key is a string literal where it is defined and a
 * constant name where the scheduler is told about it. Looking for only one of
 * them would call a live registration clean.
 *
 * The literal is matched with its quotes on. Bare, it also matches the name of
 * the match service instance the composition root still builds — which is the
 * engine this change keeps, so a bare match would fail for the opposite of the
 * reason this file exists.
 *
 * What is asserted is absence, and absence is the direction a scan fails
 * silently in: a reader that sees nothing reports the same clean result as a
 * codebase that contains nothing. So the scan is asked for the comparator's
 * key too, which IS registered next door, and must find both of its spellings
 * in the two files that carry them.
 *
 * Node environment on purpose — this reads source and evaluates none of it.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 * Decision: ADR-128 §12
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/ee/governance/services/__tests__` → `…/platform/app`. */
const APP_DIR = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const SRC_DIR = join(APP_DIR, "src");
const EE_DIR = join(APP_DIR, "ee");

/** Both spellings of the key a matcher calendar entry would have to carry. */
const IDENTITY_MATCH_KEY = [
  /["'`]governanceIdentityMatch["'`]/,
  /\bIDENTITY_MATCH_TARGET_TYPE\b/,
];

/** Both spellings of a key that IS registered, so the scan proves it reads. */
const COMPARATOR_KEY = [
  /["'`]governanceCostRollupComparator["'`]/,
  /\bCOST_ROLLUP_COMPARATOR_TARGET_TYPE\b/,
];

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js"];

/** Every source file in the app, tests and generated code excluded. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["__tests__", "__mocks__", "node_modules", "generated"].includes(
        entry.name,
      )
        ? []
        : sourceFiles(path);
    }
    if (entry.name.endsWith(".d.ts")) return [];
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [path]
      : [];
  });
}

/** Files naming any spelling of `key`, as paths relative to `platform/app`. */
function filesNaming(key: readonly RegExp[]): string[] {
  return [...sourceFiles(SRC_DIR), ...sourceFiles(EE_DIR)]
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return key.some((spelling) => spelling.test(source));
    })
    .map((file) => relative(APP_DIR, file))
    .sort();
}

describe("Feature: what books the match engine to run", () => {
  describe("given the background workers start", () => {
    /** @scenario "The matcher keeps no standing appointment of its own" */
    it("books no recurring matcher run", () => {
      expect(filesNaming(IDENTITY_MATCH_KEY)).toEqual([]);
    });

    it("has no module left that would write the entries", () => {
      expect(
        existsSync(
          join(EE_DIR, "governance/services/identityMatchSchedule.ts"),
        ),
      ).toBe(false);
    });
  });

  /**
   * The assertions above pass just as well against a scan that reads nothing.
   * This one fails if it ever does.
   */
  describe("given the scan itself", () => {
    it("finds the comparator's key where it is defined and where it is registered", () => {
      const found = filesNaming(COMPARATOR_KEY);

      expect(found).toContain(
        "ee/governance/services/costRollupComparator.service.ts",
      );
      expect(found).toContain("src/server/app-layer/presets.ts");
    });
  });
});
