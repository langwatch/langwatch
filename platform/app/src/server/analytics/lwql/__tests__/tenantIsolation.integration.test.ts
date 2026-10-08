/**
 * Isolation proof, part 1: row-policy enforcement as the restricted identity.
 *
 * Every assertion here executes as the actual restricted database user against
 * a real ClickHouse 25.10 server carrying the shipped provisioning. Nothing is
 * satisfied by a validator, a mock, or a query builder — the feature file makes
 * that a hard bar, because a validator can only prove what the gateway refuses
 * to send, never what the database refuses to answer.
 *
 * Two habits run through the file, both answers to the way isolation tests
 * quietly go vacuous:
 *
 *  - Every "no foreign rows" and "zero rows" claim is paired with an
 *    administrator-side count proving the rows it failed to return exist. An
 *    absence check passes against an empty database.
 *  - Every rejection is asserted by specific error code. "It threw" is not a
 *    proof of containment when a typo throws too.
 *
 * @see specs/lwql/api.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lwqlViewByName } from "../catalog/lwqlViews";
import {
  auditedSettingValue,
  definerViewAuditQuery,
  dropLangWatchQLRowPolicyStatement,
  lwqlDictionaryAuditQuery,
  lwqlPolicyCoverageQuery,
} from "../provisioning/accessModel";
import {
  lwqlViewSetupStatements,
  SHIPPED_LWQL_DEDUP,
} from "../provisioning/catalogStatements";
import {
  CLICKHOUSE_ERROR_CODE,
  expectClickHouseError,
  expectOnlyTenantA,
  expectRestrictedIdentity,
  expectTenantScopedRead,
  expectZeroRowsWithControl,
  type LangWatchQLClickHouseHarness,
  recordSeedControl,
  runStatement,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
} from "./lwqlClickHouseHarness";

describe("given the LangWatchQL analytics setup applied to a ClickHouse 25.10 server", () => {
  let harness: LangWatchQLClickHouseHarness;
  /** The restricted identity carrying tenant-a's valid key-hash context. */
  let tenantA: ClickHouseClient;
  let database: string;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "isolation" });
    database = harness.names.database;
    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the restricted identity carries a valid key-hash context", () => {
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    it("reads its own tenant's rows and none of the other tenant's", async () => {
      await expectRestrictedIdentity({ client: tenantA, names: harness.names });
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{ TenantId: string; TraceId: string }>(
        tenantA,
        `SELECT TenantId, TraceId FROM ${database}.traces ORDER BY TraceId`,
      );

      expectOnlyTenantA({
        rows,
        tenantColumn: "TenantId",
        harness,
        context: "baseline scoped read",
      });
      // Containment is exact, not merely "a subset": the caller sees all of its
      // own rows, so the policy is scoping rather than swallowing.
      expect(rows).toHaveLength(control.tenantA);
    });

    /**
     * The negative control for the whole suite. If detaching the mechanism does
     * not change the result, none of the assertions above are testing it.
     *
     * Runs against `spans` rather than `traces` so a failure part-way through
     * cannot leave the table every other test reads unpoliced, and restores in
     * a `finally` either way.
     */
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    /** @scenario "Detaching the row policy makes the other tenant's rows visible" */
    it("exposes the other tenant's rows once the row policy is detached, and hides them again once restored", async () => {
      const spans = harness.lwqlTables.find(
        (lwqlTable) => lwqlTable.table === "spans",
      );
      // Before the try, because the `finally` below reattaches the row policy
      // using this same entry: a rename would otherwise throw inside the try
      // and then throw again while restoring, masking the first failure and
      // leaving the source table unpoliced for every case after this one.
      if (!spans) {
        throw new Error(
          `lwql tenant-isolation suite: "spans" is not among the LangWatchQL tables, so there is no row policy to detach`,
        );
      }
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });

      let tenantsWithoutPolicy: string[] = [];
      try {
        await harness.applyAsAdmin([
          dropLangWatchQLRowPolicyStatement({
            names: harness.names,
            table: "spans",
          }),
        ]);
        const rows = await selectRows<{ TenantId: string }>(
          tenantA,
          `SELECT DISTINCT TenantId FROM ${database}.spans ORDER BY TenantId`,
        );
        tenantsWithoutPolicy = rows.map((row) => row.TenantId);
      } finally {
        // Reconverge the whole model from the definition — restores the spans
        // policy detached above (idempotent OR REPLACE).
        await harness.applyAccessModel();
      }

      expect(
        tenantsWithoutPolicy,
        "removing the row policy changed nothing — the policy is not what bounds the read",
      ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);

      const restored = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.spans`,
      );
      expect(
        restored.map((row) => row.TenantId),
        "the row policy was not restored, later tests would run unprotected",
      ).toEqual([harness.tenantA.tenantId]);
    });
  });

  describe("when the key-hash context matches no key-map entry", () => {
    /** @scenario "Empty key context yields zero rows, never all rows" */
    it("returns zero rows for an empty context without erroring", async () => {
      await expectZeroRowsWithControl({
        harness,
        keyHash: "",
        table: "traces",
        tenantColumn: "TenantId",
        context: "empty key context",
      });
    });

    /** @scenario "Garbage key context yields zero rows, never all rows" */
    it("returns zero rows for a garbage context without erroring", async () => {
      await expectZeroRowsWithControl({
        harness,
        keyHash: "not-a-real-key-hash",
        table: "traces",
        tenantColumn: "TenantId",
        context: "garbage key context",
      });
    });

    /**
     * The third key state, and the one that makes the model fail closed: a
     * caller that sends no tenant setting at all. Nothing in the request path
     * has to remember to default it — the profile already did.
     */
    /** @scenario "A caller that sends no tenant context at all reads nothing" */
    it("returns zero rows when the caller sends no tenant setting at all", async () => {
      await expectZeroRowsWithControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
        context: "absent tenant setting",
      });

      const client = await harness.restrictedClient();
      const profileDefault = await selectScalar<string>(
        client,
        `SELECT getSetting('${harness.names.tenantSetting}') AS value`,
      );
      expect(
        profileDefault,
        "the profile default is what makes an absent context read nothing",
      ).toBe("");
    });
  });

  describe("when the key-hash context carries a set of hashes (#8085)", () => {
    /**
     * The multi-project proof the pre-#8085 single-hash predicate could not
     * make: one capability carrying both tenants' hashes reads the union of
     * their rows, and a third tenant whose hash is outside the set contributes
     * nothing. Only tenant-a and tenant-b are seeded, so "no tenant outside the
     * set" is proven by the distinct set being exactly {a, b} against a control
     * that both have rows.
     */
    /** @scenario "The tenant capability set admits every project the key can read" */
    it("admits every tenant whose hash is in the set", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const bothTenants = await harness.restrictedClient({
        keyHash: `${harness.tenantA.keyHash},${harness.tenantB.keyHash}`,
      });

      const rows = await selectRows<{ TenantId: string }>(
        bothTenants,
        `SELECT TenantId FROM ${database}.traces`,
      );
      const distinct = [...new Set(rows.map((row) => row.TenantId))].sort();

      expect(distinct).toEqual(
        [harness.tenantA.tenantId, harness.tenantB.tenantId].sort(),
      );
      // Exact, not a subset: every seeded row of both tenants comes back, so
      // the set widened the scope rather than swallowing part of it.
      expect(rows).toHaveLength(control.tenantA + control.tenantB);
    });

    /** @scenario "A key-hash set of one admits exactly that project" */
    it("admits exactly the one tenant when the set holds a single hash", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const onlyA = await harness.restrictedClient({
        keyHash: harness.tenantA.keyHash,
      });

      const rows = await selectRows<{ TenantId: string }>(
        onlyA,
        `SELECT TenantId FROM ${database}.traces`,
      );

      expect(new Set(rows.map((row) => row.TenantId))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
      expect(
        rows,
        `a set of one returned rows for another tenant while ${control.tenantB} tenant-b rows exist`,
      ).toHaveLength(control.tenantA);
    });

    /** @scenario "A hash outside the key-hash set never contributes rows" */
    it("never returns a tenant whose hash the set omits, and reads nothing for an empty set", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      // tenant-b's hash is deliberately outside the set.
      const withoutB = await harness.restrictedClient({
        keyHash: harness.tenantA.keyHash,
      });
      const distinct = await selectRows<{ TenantId: string }>(
        withoutB,
        `SELECT DISTINCT TenantId FROM ${database}.traces`,
      );
      const tenants = distinct.map((row) => row.TenantId);
      expect(
        tenants,
        `a hash outside the set leaked tenant-b rows (of ${control.tenantB} seeded)`,
      ).not.toContain(harness.tenantB.tenantId);
      expect(tenants).toEqual([harness.tenantA.tenantId]);

      // An explicit empty set reads zero rows, exactly like the profile default.
      const emptySet = await harness.restrictedClient({ keyHash: "" });
      const emptyRows = await selectRows<{ TenantId: string }>(
        emptySet,
        `SELECT TenantId FROM ${database}.traces`,
      );
      expect(emptyRows).toHaveLength(0);
    });
  });

  describe("when a JOIN across two datasets runs under a key-hash set (#8085)", () => {
    /**
     * The join test above (`scopes both sides of a JOIN`) only ever runs
     * under a single-tenant context, so it cannot tell a per-table row
     * policy from a set-aware one: both would look identical against one
     * hash. This proves the join-key ("joinKeys" in `../catalog/lwqlViews.ts`
     * — `TraceId`, the key `traces` and `spans` share) stays bounded by the
     * *set* the caller's capability carries, on BOTH sides of the join at
     * once. Only tenant-a and tenant-b are seeded, so "never a third
     * tenant's rows" is proven the same way the single-table set proof does
     * it above: the distinct tenant set on each side of the join is exactly
     * `{a, b}`, not a superset that would include a tenant this suite never
     * seeded.
     */
    /** @scenario "A join across two views stays inside the key's project set" */
    it("keeps both sides of the join inside a two-tenant key-hash set, and out of a third tenant's rows", async () => {
      const tracesControl = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const spansControl = await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });
      const bothTenants = await harness.restrictedClient({
        keyHash: `${harness.tenantA.keyHash},${harness.tenantB.keyHash}`,
      });

      const rows = await selectRows<{
        traceTenant: string;
        spanTenant: string;
      }>(
        bothTenants,
        `SELECT t.TenantId AS traceTenant, s.TenantId AS spanTenant ` +
          `FROM ${database}.traces AS t ` +
          `INNER JOIN ${database}.spans AS s ON s.TraceId = t.TraceId`,
      );

      const traceTenants = [
        ...new Set(rows.map((row) => row.traceTenant)),
      ].sort();
      const spanTenants = [
        ...new Set(rows.map((row) => row.spanTenant)),
      ].sort();
      const expectedTenants = [
        harness.tenantA.tenantId,
        harness.tenantB.tenantId,
      ].sort();

      // Exact, not a subset: a set narrower than {a, b} would mean the join
      // dropped a tenant the set admits; a set wider would mean a tenant
      // outside the set (a third tenant, or an unauthorized fourth) leaked
      // through the join.
      expect(
        traceTenants,
        "JOIN left side did not stay inside the two-tenant key-hash set",
      ).toEqual(expectedTenants);
      expect(
        spanTenants,
        "JOIN right side did not stay inside the two-tenant key-hash set",
      ).toEqual(expectedTenants);
      // Union, not intersection-then-some: every row either side seeded for
      // both tenants comes back joined, so the set widened the join rather
      // than partially swallowing it.
      expect(rows).toHaveLength(
        Math.min(tracesControl.tenantA, spansControl.tenantA) +
          Math.min(tracesControl.tenantB, spansControl.tenantB),
      );
    });

    /** @scenario "A join across two views stays inside the key's project set" */
    it("narrows both sides of the join to exactly one tenant when the set holds a single hash", async () => {
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });
      const onlyA = await harness.restrictedClient({
        keyHash: harness.tenantA.keyHash,
      });

      const rows = await selectRows<{
        traceTenant: string;
        spanTenant: string;
      }>(
        onlyA,
        `SELECT t.TenantId AS traceTenant, s.TenantId AS spanTenant ` +
          `FROM ${database}.traces AS t ` +
          `INNER JOIN ${database}.spans AS s ON s.TraceId = t.TraceId`,
      );

      expect(
        rows.length,
        "a single-hash set returned nothing to check on the joined read",
      ).toBeGreaterThan(0);
      expect(
        new Set(rows.map((row) => row.traceTenant)),
        "JOIN left side leaked past a single-tenant key-hash set",
      ).toEqual(new Set([harness.tenantA.tenantId]));
      expect(
        new Set(rows.map((row) => row.spanTenant)),
        "JOIN right side leaked past a single-tenant key-hash set",
      ).toEqual(new Set([harness.tenantA.tenantId]));
    });
  });

  describe("when the query text overrides settings", () => {
    /** @scenario "Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash" */
    it("reaches no foreign rows with a guessed tenant setting", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT TenantId FROM ${database}.traces ` +
          `SETTINGS ${harness.names.tenantSetting} = 'guessed-key-hash'`,
      );

      expect(
        rows,
        `a guessed key hash returned rows while ${control.tenantB} tenant-b rows exist`,
      ).toHaveLength(0);
    });

    /**
     * The documented capability boundary, asserted rather than hidden: the key
     * hash IS the credential, so a caller holding a victim's valid hash reads
     * the victim's rows. The issue's design says exactly this ("useless without
     * a victim's valid key"), and the gateway's AST validator rejecting any
     * SETTINGS clause is the defense-in-depth layer above it. A test that
     * quietly omitted this would misrepresent what the database layer promises.
     */
    /** @scenario "Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash" */
    it("does reach the other tenant's rows when the override carries that tenant's real key hash", async () => {
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.traces ` +
          `SETTINGS ${harness.names.tenantSetting} = '${harness.tenantB.keyHash}'`,
      );

      expect(
        rows.map((row) => row.TenantId),
        "possession of a valid key hash is the security boundary at the database layer",
      ).toEqual([harness.tenantB.tenantId]);
    });

    /** @scenario "Overriding a pinned setting in query text is rejected by profile constraints" */
    it("rejects a pinned setting with a settings-constraint error", async () => {
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces SETTINGS max_execution_time = 9999`,
          ),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "overriding a pinned ceiling",
      );

      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces SETTINGS readonly = 0`,
          ),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "unpinning readonly itself",
      );

      // Not in the profile at all. `readonly = 1` refuses every setting change
      // except the tenant capability, so the CONST pins are belt and braces
      // rather than the load-bearing control.
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces SETTINGS max_threads = 64`,
          ),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "changing a setting the profile never mentions",
      );

      await expectClickHouseError(
        runStatement(tenantA, "SET readonly = 0"),
        CLICKHOUSE_ERROR_CODE.READONLY,
        "unpinning readonly as a standalone statement",
      );
    });
  });

  describe("when the query nests the LangWatchQL table in a compound shape", () => {
    /** @scenario "Row policy holds inside a CTE" */
    it("scopes reads reached through a WITH clause", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        context: "CTE",
        query:
          `WITH scoped AS (SELECT TenantId, TraceId FROM ${database}.traces) ` +
          `SELECT TenantId, TraceId FROM scoped ORDER BY TraceId`,
      });
    });

    /**
     * Shadowing the key map's name does not defeat the policy: the policy's
     * `USING` expression resolves against the real table, not the caller's
     * alias, so redefining the name in the query changes nothing.
     */
    /** @scenario "Shadowing or aliasing the key-map table name does not defeat the policy" */
    it("scopes reads when the query shadows the key-map table name", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        context: "key-map name shadowed by a CTE",
        query:
          `WITH ${harness.names.keyMapTable} AS (` +
          `  SELECT '${harness.tenantB.keyHash}' AS KeyHash, '${harness.tenantB.tenantId}' AS TenantId` +
          `) SELECT DISTINCT TenantId FROM ${database}.traces`,
      });
    });

    /** @scenario "Row policy holds across UNION ALL branches" */
    it("scopes every branch of a UNION ALL", async () => {
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        context: "UNION ALL",
        query:
          `SELECT TenantId FROM ${database}.traces ` +
          `UNION ALL SELECT TenantId FROM ${database}.spans`,
      });
    });

    /** @scenario "Row policy holds on both sides of a JOIN" */
    it("scopes both sides of a JOIN", async () => {
      await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      await recordSeedControl({
        harness,
        table: "spans",
        tenantColumn: "TenantId",
      });

      const rows = await selectRows<{
        traceTenant: string;
        spanTenant: string;
      }>(
        tenantA,
        `SELECT t.TenantId AS traceTenant, s.TenantId AS spanTenant ` +
          `FROM ${database}.traces AS t ` +
          `INNER JOIN ${database}.spans AS s ON s.TraceId = t.TraceId`,
      );

      // Both sides checked: a join is two reads, and either could be the leak.
      expectOnlyTenantA({
        rows,
        tenantColumn: "traceTenant",
        harness,
        context: "JOIN left side",
      });
      expectOnlyTenantA({
        rows,
        tenantColumn: "spanTenant",
        harness,
        context: "JOIN right side",
      });
    });

    /**
     * Aliasing another LangWatchQL table under the key map's name is the same
     * trick as the CTE shadow, in join position.
     */
    /** @scenario "Shadowing or aliasing the key-map table name does not defeat the policy" */
    it("scopes a JOIN that aliases another table as the key-map table", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "traces",
        tenantColumn: "TenantId",
        resultTenantColumn: "tenant",
        context: "key-map name reused as a join alias",
        query:
          `SELECT t.TenantId AS tenant FROM ${database}.traces AS t ` +
          `INNER JOIN ${database}.spans AS ${harness.names.keyMapTable} ` +
          `ON ${harness.names.keyMapTable}.TraceId = t.TraceId`,
      });
    });

    /** @scenario "Row policy holds inside subqueries" */
    it("scopes IN and scalar subquery positions", async () => {
      await expectTenantScopedRead({
        harness,
        client: tenantA,
        table: "spans",
        tenantColumn: "TenantId",
        context: "IN subquery",
        query:
          `SELECT TenantId FROM ${database}.spans ` +
          `WHERE TraceId IN (SELECT TraceId FROM ${database}.traces)`,
      });

      const scalar = await selectScalar<string>(
        tenantA,
        `SELECT (SELECT DISTINCT TenantId FROM ${database}.traces) AS value`,
      );
      expect(scalar, "scalar subquery position leaked a foreign tenant").toBe(
        harness.tenantA.tenantId,
      );
    });

    /**
     * The correlated `EXISTS` shape is not supported by this engine version.
     * Asserted as the fail-closed rejection it is rather than left untested:
     * writing it as if it returned scoped rows would be a false claim, and
     * dropping it would hide that a whole subquery shape is unavailable.
     */
    /** @scenario "Row policy holds inside subqueries" */
    it("rejects a correlated EXISTS subquery rather than answering it unscoped", async () => {
      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT count() FROM ${database}.traces AS t ` +
              `WHERE EXISTS (SELECT 1 FROM ${database}.spans AS s WHERE s.TraceId = t.TraceId)`,
          ),
        CLICKHOUSE_ERROR_CODE.NOT_IMPLEMENTED,
        "correlated EXISTS subquery",
      );
    });

    /**
     * `merge()` reads several tables through one name, which looks like a way
     * around a per-table policy. It is not: the policies still apply, so the
     * assertion is containment, not rejection.
     */
    /** @scenario "The merge table function is contained by the row policies" */
    it("scopes reads through the merge() table function", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const visible = await selectScalar<string>(
        tenantA,
        `SELECT count() AS value FROM merge('${database}', '^traces$')`,
      );
      expect(Number(visible)).toBe(control.tenantA);
    });
  });

  describe("when the server's query log is inspected", () => {
    /** @scenario "Key hash is auditable in the query log without exposing the raw key" */
    it("records the key hash and never the raw secret", async () => {
      // Pins the construction the audit depends on: only a digest is ever sent.
      // The expected value is written out rather than recomputed, so this stays
      // an independent check — recomputing it here would only restate whatever
      // `lwqlTenantCapability` does and would agree with it after any
      // change, including a change that stopped hashing at all.
      expect(harness.tenantA.keyHash).toBe(
        "80e5fb77f0eed9c68e4b32c0cd2f0b10be340dc6da29142c2c84c51fff50dda1",
      );
      expect(harness.tenantA.rawSecret.length).toBeGreaterThanOrEqual(24);

      const queryId = `lwql-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await selectRows(tenantA, `SELECT count() FROM ${database}.traces`, {
        query_id: queryId,
      });
      await harness.applyAsAdmin(["SYSTEM FLUSH LOGS"]);

      const entries = await selectRows<Record<string, unknown>>(
        harness.admin,
        `SELECT * FROM system.query_log WHERE query_id = '${queryId}'`,
      );
      // A missing row must fail: otherwise "the raw secret appears nowhere"
      // is satisfied by there being nothing to look at.
      expect(
        entries.length,
        "no query_log entry for the audited query — the absence assertion below would be vacuous",
      ).toBeGreaterThan(0);

      for (const entry of entries) {
        const settings = entry.Settings as Record<string, string>;
        expect(
          settings[harness.names.tenantSetting],
          "the key hash is what makes a LangWatchQL query auditable",
        ).toBe(auditedSettingValue(harness.tenantA.keyHash));

        // Serialised whole, so the check covers every column rather than the
        // handful someone thought to name.
        const serialised = JSON.stringify(entry);
        expect(
          serialised.includes(harness.tenantA.keyHash),
          "sanity: the hash should be findable in the serialised row",
        ).toBe(true);
        expect(
          serialised.includes(harness.tenantA.rawSecret),
          "the raw LangWatchQL key reached ClickHouse — only its hash may ever be sent",
        ).toBe(false);
      }
    });
  });

  describe("when a key hash is removed from the key map", () => {
    /** @scenario "Revoking a key hash from the key map takes effect within the stated revocation bound" */
    it("stops returning rows on the next query, with no refresh lag", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const revoked = await harness.restrictedClient({
        keyHash: harness.tenantA.keyHash,
      });
      const before = await selectScalar<string>(
        revoked,
        `SELECT count() AS value FROM ${database}.traces`,
      );
      expect(Number(before)).toBe(control.tenantA);

      try {
        await harness.applyAsAdmin([
          `ALTER TABLE ${database}.${harness.names.keyMapTable} ` +
            `DELETE WHERE KeyHash = '${harness.tenantA.keyHash}' SETTINGS mutations_sync = 2`,
        ]);

        const after = await selectScalar<string>(
          revoked,
          `SELECT count() AS value FROM ${database}.traces`,
        );
        expect(
          Number(after),
          `revoked key still reads rows while ${control.tenantA} exist`,
        ).toBe(0);
      } finally {
        await harness.admin.insert({
          table: `${database}.${harness.names.keyMapTable}`,
          format: "JSONEachRow",
          values: [
            {
              KeyHash: harness.tenantA.keyHash,
              TenantId: harness.tenantA.tenantId,
            },
          ],
        });
      }

      const restored = await selectScalar<string>(
        revoked,
        `SELECT count() AS value FROM ${database}.traces`,
      );
      expect(
        Number(restored),
        "the key map was not restored, later tests would read nothing",
      ).toBe(control.tenantA);
    });
  });

  describe("when the restricted identity reads the key map", () => {
    /** @scenario "The restricted identity cannot enumerate the key map beyond its own key" */
    it("sees its own row and no other tenant's key hash", async () => {
      const seeded = await selectRows<{ KeyHash: string }>(
        harness.admin,
        `SELECT KeyHash FROM ${database}.${harness.names.keyMapTable} ` +
          `WHERE KeyHash = '${harness.tenantB.keyHash}'`,
      );
      expect(
        seeded,
        "the victim hash is not in the key map — nothing below would be proving anything",
      ).toHaveLength(1);

      const visible = await selectRows<{ KeyHash: string; TenantId: string }>(
        tenantA,
        `SELECT * FROM ${database}.${harness.names.keyMapTable}`,
      );
      expect(visible).toEqual([
        {
          KeyHash: harness.tenantA.keyHash,
          TenantId: harness.tenantA.tenantId,
        },
      ]);
      expect(
        JSON.stringify(visible).includes(harness.tenantB.keyHash),
        "another tenant's key hash was enumerable",
      ).toBe(false);

      // Probing a hash the caller already guessed is answered as a miss, so the
      // key map cannot be used as an oracle to confirm one.
      const probe = await selectScalar<string>(
        tenantA,
        `SELECT count() AS value FROM ${database}.${harness.names.keyMapTable} ` +
          `WHERE KeyHash = '${harness.tenantB.keyHash}'`,
      );
      expect(Number(probe)).toBe(0);

      const tenants = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.${harness.names.keyMapTable}`,
      );
      expect(tenants.map((row) => row.TenantId)).toEqual([
        harness.tenantA.tenantId,
      ]);
    });

    /**
     * A dictionary is not subject to row policies, so a tenant-scoped one would
     * be a bypass with no policy to enforce — the reason the shipped key map is
     * a self-policed table instead.
     */
    /** @scenario "No dictionary in the LangWatchQL schema could serve the same data unpoliced" */
    it("has no dictionary in the LangWatchQL database that could serve the same data unpoliced", async () => {
      const dictionaries = await selectRows<{ name: string }>(
        harness.admin,
        lwqlDictionaryAuditQuery({ names: harness.names }),
      );
      expect(dictionaries).toEqual([]);
    });
  });

  describe("when the restricted identity attempts to write or change the schema", () => {
    /** @scenario "Writes, DDL, and temporary objects are rejected by the restricted identity itself" */
    it("rejects every write, DDL, and temporary-object statement by grants", async () => {
      const rejected: Array<[string, string]> = [
        [
          "INSERT",
          `INSERT INTO ${database}.traces VALUES ('tenant-b','x','m',1)`,
        ],
        ["ALTER", `ALTER TABLE ${database}.traces DELETE WHERE 1`],
        [
          "CREATE TABLE",
          `CREATE TABLE ${database}.evil (x UInt8) ENGINE = Memory`,
        ],
        ["CREATE TEMPORARY TABLE", "CREATE TEMPORARY TABLE evil (x UInt8)"],
        ["DROP", `DROP TABLE ${database}.traces`],
        ["TRUNCATE", `TRUNCATE TABLE ${database}.traces`],
        ["CREATE VIEW", `CREATE VIEW ${database}.evil_view AS SELECT 1`],
        [
          "ATTACH",
          `ATTACH TABLE ${database}.evil_attached (x UInt8) ENGINE = Memory`,
        ],
        [
          "CREATE ROW POLICY",
          `CREATE ROW POLICY evil ON ${database}.traces USING 1 TO ${harness.names.restrictedUser}`,
        ],
        [
          // Derived, not spelled by hand: ClickHouse checks the privilege
          // before it resolves the object, so a hardcoded name that no longer
          // matches any policy still raises ACCESS_DENIED and still passes —
          // while having stopped testing a refusal to drop a policy that
          // actually exists.
          "DROP ROW POLICY",
          dropLangWatchQLRowPolicyStatement({
            names: harness.names,
            table: "traces",
          }),
        ],
        [
          "GRANT",
          `GRANT SELECT ON ${database}.traces TO ${harness.names.restrictedUser}`,
        ],
        [
          "CREATE USER",
          "CREATE USER evil IDENTIFIED WITH plaintext_password BY 'x'",
        ],
      ];

      for (const [label, query] of rejected) {
        await expectClickHouseError(
          runStatement(tenantA, query),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          label,
        );
      }

      // The policy the reader tried to drop is still in force.
      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.traces`,
      );
      expect(rows.map((row) => row.TenantId)).toEqual([
        harness.tenantA.tenantId,
      ]);
    });

    /** @scenario "Multiple statements in one request are rejected" */
    it("rejects two statements submitted in one request", async () => {
      await expectClickHouseError(
        runStatement(tenantA, `SELECT 1; SELECT 2`),
        CLICKHOUSE_ERROR_CODE.SYNTAX_ERROR,
        "multi-statement request",
      );
    });
  });

  describe("when the restricted identity attempts to reach outside the LangWatchQL schema", () => {
    /** @scenario "Table functions are rejected for the restricted identity by grants" */
    it("rejects the table functions that reach external systems", async () => {
      const rejected: Array<[string, string]> = [
        [
          "url",
          `SELECT * FROM url('http://example.invalid/', 'CSV', 'a String')`,
        ],
        [
          "s3",
          `SELECT * FROM s3('http://example.invalid/f.csv', 'CSV', 'a String')`,
        ],
        [
          "remote",
          `SELECT * FROM remote('127.0.0.1', 'system', 'one', 'u', 'p')`,
        ],
        ["file", `SELECT * FROM file('x.csv', 'CSV', 'a String')`],
        [
          "postgresql",
          `SELECT * FROM postgresql('127.0.0.1:5432', 'db', 'tbl', 'u', 'p')`,
        ],
      ];
      for (const [label, query] of rejected) {
        await expectClickHouseError(
          () => selectRows(tenantA, query),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          `${label} table function`,
        );
      }
    });

    /**
     * The generators reach no data at all, so they are deliberately left
     * available rather than being holes in the grant policy. Pinned so that a
     * later blanket ban is a decision someone makes, not a silent regression.
     */
    /** @scenario "Table functions that read no data remain available" */
    it("still allows the table functions that read no data", async () => {
      const allowed: Array<[string, string]> = [
        ["numbers", "SELECT count() AS value FROM numbers(5)"],
        ["values", "SELECT count() AS value FROM values('x UInt8', 1, 2)"],
        ["view", "SELECT count() AS value FROM view(SELECT 1 AS x)"],
        [
          "generateRandom",
          "SELECT count() AS value FROM (SELECT * FROM generateRandom('a UInt8') LIMIT 3)",
        ],
      ];
      for (const [label, query] of allowed) {
        const count = await selectScalar<string>(tenantA, query);
        expect(Number(count), `${label} was refused`).toBeGreaterThan(0);
      }
    });

    /** @scenario "System and internal schema access is rejected for the restricted identity" */
    it("rejects the system tables holding users, query history, and policy definitions", async () => {
      const rejected = [
        "system.users",
        "system.query_log",
        "system.row_policies",
        "system.dictionaries",
        "system.grants",
        "system.settings_profiles",
        "system.named_collections",
        "information_schema.tables",
      ];
      for (const table of rejected) {
        await expectClickHouseError(
          () => selectRows(tenantA, `SELECT count() FROM ${table}`),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          table,
        );
      }
    });

    /**
     * `system.settings` is readable and must not be asserted otherwise. It is
     * session-scoped: it exposes the caller's OWN tenant context and no other
     * tenant's, which is the property worth pinning.
     */
    /** @scenario "System and internal schema access is rejected for the restricted identity" */
    it("exposes only the caller's own tenant context through the readable settings view", async () => {
      const total = await selectScalar<string>(
        tenantA,
        "SELECT count() AS value FROM system.settings",
      );
      expect(
        Number(total),
        "system.settings is readable by design; a zero here means the check is measuring nothing",
      ).toBeGreaterThan(0);

      const own = await selectScalar<string>(
        tenantA,
        `SELECT value FROM system.settings WHERE name = '${harness.names.tenantSetting}'`,
      );
      expect(own).toBe(auditedSettingValue(harness.tenantA.keyHash));

      // Compared in TypeScript rather than in SQL: the value read back from
      // system.settings is the field-dumped form and already carries its own
      // quotes, so interpolating it into a SQL literal double-quotes it. This
      // also widens the check from one column to every setting in the view.
      const otherTenantValue = auditedSettingValue(harness.tenantB.keyHash);
      const allSettings = await selectRows<{ name: string; value: string }>(
        tenantA,
        "SELECT name, value FROM system.settings",
      );
      expect(
        allSettings.filter((setting) => setting.value === otherTenantValue),
        "another tenant's context was visible in the session settings view",
      ).toHaveLength(0);
    });

    /**
     * `system.tables` is readable too, but permission-filtered. Compared
     * against the grants rather than a hard-coded count, so adding a LangWatchQL
     * object does not turn this red for the wrong reason.
     */
    /** @scenario "Only the granted objects are visible through the readable tables view" */
    it("shows only the granted objects through the readable tables view", async () => {
      const granted = await selectRows<{ table: string }>(
        harness.admin,
        `SELECT DISTINCT table FROM system.grants ` +
          `WHERE user_name = '${harness.names.restrictedUser}' AND database = '${database}' ` +
          `AND access_type = 'SELECT' AND table IS NOT NULL ` +
          `AND table IN (SELECT name FROM system.tables WHERE database = '${database}') ` +
          `ORDER BY table`,
      );
      expect(granted.length).toBeGreaterThan(0);

      const visible = await selectRows<{ name: string }>(
        tenantA,
        `SELECT name FROM system.tables WHERE database = '${database}' ORDER BY name`,
      );
      expect(visible.map((row) => row.name)).toEqual(
        granted.map((row) => row.table),
      );
    });
  });

  describe("when the LangWatchQL database's own definitions are audited", () => {
    /**
     * Enumerated from the server rather than from a list in this file: adding a
     * LangWatchQL object and granting it without writing its row policy turns this
     * red with no test edit.
     */
    /** @scenario "Every LangWatchQL object has an effective row policy" */
    it("has an effective row policy for every object the restricted identity can read", async () => {
      const coverage = await selectRows<{ table: string; has_policy: number }>(
        harness.admin,
        lwqlPolicyCoverageQuery({ names: harness.names }),
      );
      expect(
        coverage.length,
        "no exposed objects found — the coverage check would certify nothing",
      ).toBeGreaterThan(0);
      const uncovered = coverage
        .filter((row) => Number(row.has_policy) !== 1)
        .map((row) => row.table);
      expect(
        uncovered,
        "LangWatchQL objects are readable with no row policy applying to the restricted identity",
      ).toEqual([]);
    });

    /**
     * A `SQL SECURITY DEFINER` view reads its sources as its definer rather
     * than as the caller, so row policies simply do not apply to it — a
     * complete bypass of the model. Proved here so the hazard is documented and
     * falsifiable, and immediately followed by the guard that would catch one,
     * exercised against a real offender so the guard cannot be vacuous.
     */
    /** @scenario "A definer-rights view bypasses the row policy and is reported by the audit" */
    it("detects a DEFINER view as the row-policy bypass it is, and reports a clean database otherwise", async () => {
      const definerView = "v_definer_probe";
      const invokerView = "v_invoker_probe";

      const cleanBefore = await selectRows(
        harness.admin,
        definerViewAuditQuery({ names: harness.names }),
      );
      expect(
        cleanBefore,
        "the LangWatchQL database already contains a DEFINER view",
      ).toEqual([]);

      let definerTenants: string[] = [];
      let invokerTenants: string[] = [];
      let flagged: string[] = [];
      try {
        await harness.applyAsAdmin([
          `CREATE VIEW ${database}.${definerView} DEFINER = CURRENT_USER SQL SECURITY DEFINER ` +
            `AS SELECT TenantId, TraceId FROM ${database}.traces`,
          `CREATE VIEW ${database}.${invokerView} SQL SECURITY INVOKER ` +
            `AS SELECT TenantId, TraceId FROM ${database}.traces`,
          // Ad-hoc probe views this test alone creates: a plain whole-object
          // grant so the restricted identity can read them. Not a reusable
          // builder — the shipped access model is single-sourced (#8258).
          `GRANT SELECT ON ${database}.${definerView} TO ${harness.names.restrictedUser}`,
          `GRANT SELECT ON ${database}.${invokerView} TO ${harness.names.restrictedUser}`,
        ]);

        definerTenants = (
          await selectRows<{ TenantId: string }>(
            tenantA,
            `SELECT DISTINCT TenantId FROM ${database}.${definerView} ORDER BY TenantId`,
          )
        ).map((row) => row.TenantId);
        invokerTenants = (
          await selectRows<{ TenantId: string }>(
            tenantA,
            `SELECT DISTINCT TenantId FROM ${database}.${invokerView} ORDER BY TenantId`,
          )
        ).map((row) => row.TenantId);
        flagged = (
          await selectRows<{ name: string }>(
            harness.admin,
            definerViewAuditQuery({ names: harness.names }),
          )
        ).map((row) => row.name);
      } finally {
        // The grant OUTLIVES the drop, so revoking is not optional: a leftover
        // grant on a vanished object would poison the coverage audit.
        await harness.applyAsAdmin([
          `REVOKE SELECT ON ${database}.${definerView} FROM ${harness.names.restrictedUser}`,
          `REVOKE SELECT ON ${database}.${invokerView} FROM ${harness.names.restrictedUser}`,
          `DROP TABLE IF EXISTS ${database}.${definerView}`,
          `DROP TABLE IF EXISTS ${database}.${invokerView}`,
        ]);
      }

      expect(
        definerTenants,
        "a DEFINER view no longer bypasses row policies — the guard below may be unnecessary",
      ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);
      expect(invokerTenants).toEqual([harness.tenantA.tenantId]);
      expect(
        flagged,
        "the audit did not flag a DEFINER view, so it would not catch one that shipped",
      ).toContain(definerView);

      const cleanAfter = await selectRows(
        harness.admin,
        definerViewAuditQuery({ names: harness.names }),
      );
      expect(cleanAfter).toEqual([]);
    });
  });
});

/**
 * Tenant isolation for the coding-agent datasets (#8085 / #8116 Part A),
 * proved over the *shipped* migrations rather than the toy fixture above —
 * `coding_agent_sessions` and `coding_agent_session_events` do not exist in
 * the fixture schema, only in a real migrated database, so this runs its own
 * harness instance under `facts: "migrated"` (the same mode
 * `catalogStatements.integration.test.ts` uses) and provisions only the two
 * views under proof, not the whole catalog.
 *
 * @see specs/lwql/coding-agent-datasets.feature
 */
describe("given the coding-agent datasets provisioned over the shipped migrations (#8085)", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let tenantB: ClickHouseClient;
  let database: string;
  let facts: string;

  function codingSessionRow({
    tenantId,
    sessionId,
  }: {
    tenantId: string;
    sessionId: string;
  }) {
    return {
      TenantId: tenantId,
      SessionId: sessionId,
      SessionKeySource: "agent",
      Version: "1",
      StartedAt: "2026-02-20 12:00:00.000",
      Agent: "claude_code",
      AgentVersion: "1.0.0",
      GitBranch: "main",
      ModelCalls: 4,
      CostUsd: 1.5,
    };
  }

  function codingSessionEventRow({
    tenantId,
    sessionId,
    recordId,
  }: {
    tenantId: string;
    sessionId: string;
    recordId: string;
  }) {
    return {
      TenantId: tenantId,
      SessionId: sessionId,
      TimeUnixMs: "2026-02-20 12:00:01.000",
      // FixedString(64): padded so a short fixture id still fits the column.
      RecordId: recordId.padEnd(64, "0"),
      EventKind: "model_call",
      Agent: "claude_code",
      SessionKeySource: "agent",
      CostUsd: 0.02,
    };
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({
      suite: "codingagent",
      facts: "migrated",
    });
    database = harness.names.database;
    facts = harness.factDatabase;

    const sessions = lwqlViewByName("coding_sessions");
    const sessionEvents = lwqlViewByName("coding_session_events");
    if (!sessions || !sessionEvents) {
      throw new Error(
        "coding_sessions / coding_session_events are not registered in LWQL_VIEW_CATALOG — nothing to provision",
      );
    }

    await harness.applyAsAdmin(
      lwqlViewSetupStatements({
        names: harness.names,
        sourceDatabase: facts,
        views: [sessions, sessionEvents],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    // Grants and source-table policies for the coding-agent datasets, from the
    // single access-model emitter (#8258) — the view statements are structural.
    await harness.applyAccessModel({
      views: [sessions, sessionEvents],
      sourceDatabase: facts,
    });

    await harness.admin.insert({
      table: `${facts}.coding_agent_sessions`,
      format: "JSONEachRow",
      values: [
        codingSessionRow({
          tenantId: harness.tenantA.tenantId,
          sessionId: "session-a-1",
        }),
        codingSessionRow({
          tenantId: harness.tenantB.tenantId,
          sessionId: "session-b-1",
        }),
      ],
    });
    await harness.admin.insert({
      table: `${facts}.coding_agent_session_events`,
      format: "JSONEachRow",
      values: [
        codingSessionEventRow({
          tenantId: harness.tenantA.tenantId,
          sessionId: "session-a-1",
          recordId: "record-a-1",
        }),
        codingSessionEventRow({
          tenantId: harness.tenantB.tenantId,
          sessionId: "session-b-1",
          recordId: "record-b-1",
        }),
      ],
    });

    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
    tenantB = await harness.restrictedClient({
      keyHash: harness.tenantB.keyHash,
    });
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when a tenant reads coding_sessions", () => {
    /** @scenario "List sessions" */
    it("reads only its own tenant's rows, and none of the other tenant's", async () => {
      const control = await recordSeedControl({
        harness,
        table: "coding_agent_sessions",
        tenantColumn: "TenantId",
        database: facts,
      });

      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT TenantId FROM ${database}.coding_sessions`,
      );

      expectOnlyTenantA({
        rows,
        tenantColumn: "TenantId",
        harness,
        context: "coding_sessions",
      });
      expect(rows).toHaveLength(control.tenantA);
    });
  });

  describe("when a tenant reads coding_session_events", () => {
    /** @scenario "Read every event of a session" */
    it("reads only its own tenant's rows, and none of the other tenant's", async () => {
      const control = await recordSeedControl({
        harness,
        table: "coding_agent_session_events",
        tenantColumn: "TenantId",
        database: facts,
      });

      const rows = await selectRows<{ TenantId: string }>(
        tenantB,
        `SELECT TenantId FROM ${database}.coding_session_events`,
      );

      expect(new Set(rows.map((row) => row.TenantId))).toEqual(
        new Set([harness.tenantB.tenantId]),
      );
      expect(rows).toHaveLength(control.tenantB);
    });
  });

  describe("when a query joins both coding-agent datasets", () => {
    it("keeps both sides of the join inside the caller's own tenant", async () => {
      await recordSeedControl({
        harness,
        table: "coding_agent_sessions",
        tenantColumn: "TenantId",
        database: facts,
      });
      await recordSeedControl({
        harness,
        table: "coding_agent_session_events",
        tenantColumn: "TenantId",
        database: facts,
      });

      const rows = await selectRows<{
        sessionTenant: string;
        eventTenant: string;
      }>(
        tenantA,
        `SELECT s.TenantId AS sessionTenant, e.TenantId AS eventTenant ` +
          `FROM ${database}.coding_sessions AS s ` +
          `INNER JOIN ${database}.coding_session_events AS e ON e.SessionId = s.SessionId`,
      );

      expect(
        rows.length,
        "the join returned nothing to check tenant scoping on",
      ).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.sessionTenant))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
      expect(new Set(rows.map((row) => row.eventTenant))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
    });
  });

  describe("when the key-hash context matches no project", () => {
    it("returns zero rows from both coding-agent datasets, never an error", async () => {
      const noProject = await harness.restrictedClient({
        keyHash: "not-a-real-key-hash",
      });

      const sessions = await selectRows(
        noProject,
        `SELECT SessionId FROM ${database}.coding_sessions`,
      );
      const events = await selectRows(
        noProject,
        `SELECT SessionId FROM ${database}.coding_session_events`,
      );

      expect(sessions).toHaveLength(0);
      expect(events).toHaveLength(0);
    });
  });
});
