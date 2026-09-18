/**
 * The single-source parity guard for the LangWatchQL tenant predicate (ADR-101).
 *
 * The tenant row filter and the key-map self-filter are defined once, as SQL
 * text with `{placeholder}` slots, in two files under the Go config renderer's
 * package:
 *
 *   infra/clickhouse-serverless/internal/render/lwqlTenantPredicate.sql
 *   infra/clickhouse-serverless/internal/render/lwqlKeyMapSelfFilter.sql
 *
 * `lwql.go` embeds those files with `//go:embed`, so the chart-rendered row
 * filter *is* their content. This app mirrors them as the string constants
 * `LWQL_TENANT_PREDICATE_TEMPLATE` and `LWQL_KEY_MAP_SELF_FILTER_TEMPLATE`, which
 * `accessModel.ts` renders into the row policy it self-provisions on a BYO
 * server.
 *
 * ADR-101's failure mode is silent: a predicate that drifts between the two
 * ownership paths returns zero rows or over-broad rows on whichever server
 * reads the stale copy. This test is the drift alarm — it fails the build the
 * moment the app constant and the embedded file stop being byte-identical, so a
 * change to one is forced onto the other (and thus onto the Go renderer).
 *
 * @see infra/clickhouse-serverless/internal/render/lwql.go — the Go consumer
 * @see specs/lwql/api.feature
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LWQL_KEY_MAP_SELF_FILTER_TEMPLATE,
  LWQL_TENANT_PREDICATE_TEMPLATE,
} from "../accessModel";

/**
 * The repository root, found by walking up from this file until the Go
 * renderer's package is in view. Resolving by a marker rather than a fixed
 * `../` depth keeps the test correct if the file moves.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 15; i++) {
    if (existsSync(join(dir, "infra/clickhouse-serverless/internal/render"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error(
    "lwql predicate parity: could not locate the repository root (infra/clickhouse-serverless/internal/render)",
  );
}

function embeddedSql(fileName: string): string {
  return readFileSync(
    join(repoRoot(), "infra/clickhouse-serverless/internal/render", fileName),
    "utf8",
  ).trim();
}

describe("given the single-sourced LangWatchQL tenant predicate template", () => {
  describe("when the application constant is compared with the file the Go renderer embeds", () => {
    /** @scenario "The tenant predicate and the rendered config predicate are the same text" */
    it("is byte-identical to lwqlTenantPredicate.sql", () => {
      expect(LWQL_TENANT_PREDICATE_TEMPLATE).toBe(
        embeddedSql("lwqlTenantPredicate.sql"),
      );
    });

    /** @scenario "The tenant predicate and the rendered config predicate are the same text" */
    it("is byte-identical to lwqlKeyMapSelfFilter.sql", () => {
      expect(LWQL_KEY_MAP_SELF_FILTER_TEMPLATE).toBe(
        embeddedSql("lwqlKeyMapSelfFilter.sql"),
      );
    });

    /**
     * The template must be a SET membership, not the pre-#8085 single-hash
     * equality: `splitByChar` over the comma-joined capability is what lets one
     * key reach every project it can read, and the empty default still reads
     * zero rows because no key hash equals the empty string.
     */
    /** @scenario "The tenant predicate and the rendered config predicate are the same text" */
    it("resolves the tenant through set membership of the capability", () => {
      expect(LWQL_TENANT_PREDICATE_TEMPLATE).toContain(
        "has(splitByChar(',', getSetting('{tenantSetting}')), {keyHash})",
      );
      // The per-hash fail-closed guard survives the move to a set: each in-set
      // hash is grouped and admitted only when it maps to exactly one tenant.
      expect(LWQL_TENANT_PREDICATE_TEMPLATE).toContain("GROUP BY {keyHash}");
      expect(LWQL_TENANT_PREDICATE_TEMPLATE).toContain(
        "HAVING uniqExact({tenantId}) = 1",
      );
    });
  });
});
