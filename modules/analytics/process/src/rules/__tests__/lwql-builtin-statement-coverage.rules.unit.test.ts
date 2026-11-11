/**
 * Regenerating the list keeps newest first and never loses a hash it once held.
 * @see specs/lwql/query-origin.feature
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  mergeCoverageCommits,
  renderBuiltinStatements,
} from "../lwql-builtin-statement-coverage.rules.ts";
import {
  LWQL_BUILTIN_STATEMENT_COVERAGE,
  LWQL_BUILTIN_STATEMENT_HASHES,
} from "../lwql-builtin-statements.generated.ts";

const PINNED: readonly string[] = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("./fixtures/lwql-builtin-statement-hashes.baseline.json", import.meta.url),
    ),
    "utf8",
  ),
);

/** The pinned hashes the list no longer holds: grow-only means this is always empty. */
function hashesMissingFromList({
  pinned,
  list,
}: {
  pinned: readonly string[];
  list: readonly string[];
}): string[] {
  const held = new Set(list);
  return pinned.filter((hash) => !held.has(hash));
}

describe("given the covered commits, newest first", () => {
  /** @scenario "A new stock version is named newest and the oldest stays oldest" */
  it("puts a new commit at the front so the oldest commit stays the oldest", () => {
    const merged = mergeCoverageCommits({ existing: ["bbb", "aaa"], newest: "ccc", older: [] });

    expect(merged).toEqual(["ccc", "bbb", "aaa"]);
    expect(merged.at(-1)).toBe("aaa");
  });

  /** @scenario "A new stock version is named newest and the oldest stays oldest" */
  it("leaves the list alone when the newest commit is already on it", () => {
    expect(mergeCoverageCommits({ existing: ["bbb", "aaa"], newest: "bbb", older: [] })).toEqual([
      "bbb",
      "aaa",
    ]);
  });

  /** @scenario "A new stock version is named newest and the oldest stays oldest" */
  it("adds an older version at the back and skips blanks", () => {
    expect(
      mergeCoverageCommits({ existing: ["bbb", "aaa"], newest: "", older: ["000", "aaa", ""] }),
    ).toEqual(["bbb", "aaa", "000"]);
  });
});

describe("given the pinned baseline of hashes", () => {
  /** @scenario "Removing a hash from the list fails the check" */
  it("reports a hash taken out of the list", () => {
    const [removed, ...kept] = PINNED;

    expect(hashesMissingFromList({ pinned: PINNED, list: kept })).toEqual([removed]);
  });

  /** @scenario "Removing a hash from the list fails the check" */
  it("finds every pinned hash still on the generated list", () => {
    expect(PINNED.length).toBeGreaterThan(0);
    expect(hashesMissingFromList({ pinned: PINNED, list: LWQL_BUILTIN_STATEMENT_HASHES })).toEqual(
      [],
    );
  });
});

describe("given the committed built-in statement list", () => {
  /** @scenario "The list says what it covers" */
  it("equals a render of the commits and hashes it holds", () => {
    const committed = readFileSync(
      fileURLToPath(new URL("../lwql-builtin-statements.generated.ts", import.meta.url)),
      "utf8",
    );

    expect(committed, "regenerate with `pnpm generate:lwql-builtin-statements`").toBe(
      renderBuiltinStatements({
        commits: LWQL_BUILTIN_STATEMENT_COVERAGE.commits,
        hashes: LWQL_BUILTIN_STATEMENT_HASHES,
      }),
    );
  });
});
