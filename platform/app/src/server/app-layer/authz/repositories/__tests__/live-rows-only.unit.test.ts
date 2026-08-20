/** @vitest-environment node */

/**
 * A revoke MARKS its row; it does not delete it. That is what stops a
 * redelivered `attached` resurrecting a grant nothing was left to contradict
 * — and it means every read that decides access has to say so, because an
 * unfiltered one now authorizes a grant that was revoked.
 *
 * The filter is one clause and easy to leave out of a new query, and leaving
 * it out fails open. So it is checked here rather than trusted: this reads
 * the repositories' source and refuses a grant or role query that does not
 * fence on the mark.
 *
 * Deliberately out of scope: the migration repository, whose job is to
 * inventory what an organization HAS held, ended or not.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORIES = path.join(import.meta.dirname, "..");

/** The repositories whose reads answer, or list, live access. */
const ACCESS_READING_SOURCES = [
  "authz-read.grants.repository.ts",
  "access-listing.grants.repository.ts",
];

/** `prisma.grant.findMany({ where: { … } })` and friends, with their clause. */
const QUERY = /prisma\.(grant|role)\.(findMany|findFirst|findUnique)\(\{\s*\n?\s*where:\s*\{([^}]*)/g;

function unfencedQueriesIn(file: string): string[] {
  const source = readFileSync(path.join(REPOSITORIES, file), "utf8");
  const unfenced: string[] = [];

  for (const match of source.matchAll(QUERY)) {
    const [, model, method, clause = ""] = match;
    const fence = model === "grant" ? "revokedAt: null" : "deletedAt: null";
    if (clause.includes(fence)) continue;
    // `findUnique` by primary key cannot carry the fence in its own where —
    // its callers filter on the row they read back.
    if (method === "findUnique") continue;
    const line = source.slice(0, match.index).split("\n").length;
    unfenced.push(`${file}:${line} ${model}.${method} does not fence on ${fence}`);
  }

  return unfenced;
}

describe("authorization reads", () => {
  describe("given a revoke marks its row rather than deleting it", () => {
    /** @scenario "A revoked grant authorizes nothing" */
    it("fences every access-deciding query on the mark", () => {
      const unfenced = ACCESS_READING_SOURCES.flatMap(unfencedQueriesIn).sort();

      expect(unfenced).toEqual([]);
    });

    /** @scenario "The sweep reads queries that actually exist" */
    it("finds queries to check, so a passing result means something", () => {
      const source = readFileSync(
        path.join(REPOSITORIES, "authz-read.grants.repository.ts"),
        "utf8",
      );

      expect([...source.matchAll(QUERY)].length).toBeGreaterThan(3);
    });
  });
});
