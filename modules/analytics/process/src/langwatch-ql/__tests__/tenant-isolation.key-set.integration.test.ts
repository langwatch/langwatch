/**
 * Isolation proof, the multi-project half (#8085): a key-hash set reads exactly its tenants'
 * union, joins stay inside the set, and the coding-agent views hold the same line.
 * @see specs/lwql/api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pickLwqlViewByName } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLViewProvisioningService } from "../../services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../services/langwatch-ql-view-statements.service.ts";
import {
  expectOnlyTenantA,
  type LangWatchQLClickHouseHarness,
  recordSeedControl,
  selectRows,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

describe("given the LangWatchQL setup and two seeded tenants", () => {
  let harness: LangWatchQLClickHouseHarness;
  let database: string;

  const bothHashes = () => `${harness.tenantA.keyHash},${harness.tenantB.keyHash}`;
  const sortedTenants = () => [harness.tenantA.tenantId, harness.tenantB.tenantId].toSorted();

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "keyset" });
    database = harness.names.database;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("when the key-hash context carries a set of hashes", () => {
    /** @scenario "The tenant capability set admits every project the key can read" */
    it("admits every tenant whose hash is in the set", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const bothTenants = await harness.restrictedClient({ keyHash: bothHashes() });

      const rows = await selectRows<{ TenantId: string }>(
        bothTenants,
        `SELECT TenantId FROM ${database}.traces`,
      );

      expect([...new Set(rows.map((row) => row.TenantId))].toSorted()).toEqual(sortedTenants());
      // Exact, not a subset: the set widened the scope rather than swallowing part of it.
      expect(rows).toHaveLength(control.tenantA + control.tenantB);
    });

    /** @scenario "A key-hash set of one admits exactly that project" */
    it("admits exactly the one tenant when the set holds a single hash", async () => {
      const control = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const onlyA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });

      const rows = await selectRows<{ TenantId: string }>(
        onlyA,
        `SELECT TenantId FROM ${database}.traces`,
      );

      expect(new Set(rows.map((row) => row.TenantId))).toEqual(new Set([harness.tenantA.tenantId]));
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
      const withoutB = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });

      const tenants = (
        await selectRows<{ TenantId: string }>(
          withoutB,
          `SELECT DISTINCT TenantId FROM ${database}.traces`,
        )
      ).map((row) => row.TenantId);

      expect(
        tenants,
        `a hash outside the set leaked tenant-b rows (of ${control.tenantB} seeded)`,
      ).toEqual([harness.tenantA.tenantId]);

      const emptySet = await harness.restrictedClient({ keyHash: "" });
      expect(await selectRows(emptySet, `SELECT TenantId FROM ${database}.traces`)).toHaveLength(0);
    });
  });

  describe("when a JOIN across two views runs under a key-hash set", () => {
    const joinSql = () =>
      `SELECT t.TenantId AS traceTenant, s.TenantId AS spanTenant ` +
      `FROM ${database}.traces AS t ` +
      `INNER JOIN ${database}.spans AS s ON s.TraceId = t.TraceId`;

    /** @scenario "A join across two views stays inside the key's project set" */
    it("keeps both sides of the join inside a two-tenant set, and out of any other tenant's rows", async () => {
      const traces = await recordSeedControl({
        harness,
        table: "traces",
        tenantColumn: "TenantId",
      });
      const spans = await recordSeedControl({ harness, table: "spans", tenantColumn: "TenantId" });
      const bothTenants = await harness.restrictedClient({ keyHash: bothHashes() });

      const rows = await selectRows<{ traceTenant: string; spanTenant: string }>(
        bothTenants,
        joinSql(),
      );

      expect(
        [...new Set(rows.map((row) => row.traceTenant))].toSorted(),
        "JOIN left side did not stay inside the two-tenant key-hash set",
      ).toEqual(sortedTenants());
      expect(
        [...new Set(rows.map((row) => row.spanTenant))].toSorted(),
        "JOIN right side did not stay inside the two-tenant key-hash set",
      ).toEqual(sortedTenants());
      expect(rows).toHaveLength(
        Math.min(traces.tenantA, spans.tenantA) + Math.min(traces.tenantB, spans.tenantB),
      );
    });

    /** @scenario "A join across two views stays inside the key's project set" */
    it("narrows both sides of the join to exactly one tenant when the set holds a single hash", async () => {
      await recordSeedControl({ harness, table: "traces", tenantColumn: "TenantId" });
      await recordSeedControl({ harness, table: "spans", tenantColumn: "TenantId" });
      const onlyA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });

      const rows = await selectRows<{ traceTenant: string; spanTenant: string }>(onlyA, joinSql());

      expect(
        rows.length,
        "a single-hash set returned nothing to check on the joined read",
      ).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.traceTenant))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
      expect(new Set(rows.map((row) => row.spanTenant))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
    });
  });
});

describe("given the coding-agent views provisioned over the shipped migrations", () => {
  let harness: LangWatchQLClickHouseHarness;
  let tenantA: ClickHouseClient;
  let tenantB: ClickHouseClient;
  let database: string;
  let facts: string;

  const sessionRow = ({ tenantId, sessionId }: { tenantId: string; sessionId: string }) => ({
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
  });

  const eventRow = ({
    tenantId,
    sessionId,
    recordId,
  }: {
    tenantId: string;
    sessionId: string;
    recordId: string;
  }) => ({
    TenantId: tenantId,
    SessionId: sessionId,
    TimeUnixMs: "2026-02-20 12:00:01.000",
    // FixedString(64): padded so a short fixture id still fits the column.
    RecordId: recordId.padEnd(64, "0"),
    EventKind: "model_call",
    Agent: "claude_code",
    SessionKeySource: "agent",
    CostUsd: 0.02,
  });

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "codingagent", facts: "migrated" });
    database = harness.names.database;
    facts = harness.factDatabase;

    const sessions = pickLwqlViewByName("coding_sessions");
    const sessionEvents = pickLwqlViewByName("coding_session_events");
    if (!sessions || !sessionEvents) {
      throw new Error("coding_sessions / coding_session_events are not in LWQL_VIEW_CATALOG");
    }
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names: harness.names,
        sourceDatabase: facts,
        views: [sessions, sessionEvents],
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );

    await harness.admin.insert({
      table: `${facts}.coding_agent_sessions`,
      format: "JSONEachRow",
      values: [
        sessionRow({ tenantId: harness.tenantA.tenantId, sessionId: "session-a-1" }),
        sessionRow({ tenantId: harness.tenantB.tenantId, sessionId: "session-b-1" }),
      ],
    });
    await harness.admin.insert({
      table: `${facts}.coding_agent_session_events`,
      format: "JSONEachRow",
      values: [
        eventRow({
          tenantId: harness.tenantA.tenantId,
          sessionId: "session-a-1",
          recordId: "record-a-1",
        }),
        eventRow({
          tenantId: harness.tenantB.tenantId,
          sessionId: "session-b-1",
          recordId: "record-b-1",
        }),
      ],
    });

    tenantA = await harness.restrictedClient({ keyHash: harness.tenantA.keyHash });
    tenantB = await harness.restrictedClient({ keyHash: harness.tenantB.keyHash });
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

      expectOnlyTenantA({ rows, tenantColumn: "TenantId", harness, context: "coding_sessions" });
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

      expect(new Set(rows.map((row) => row.TenantId))).toEqual(new Set([harness.tenantB.tenantId]));
      expect(rows).toHaveLength(control.tenantB);
    });
  });

  describe("when a query joins both coding-agent views", () => {
    it("keeps both sides of the join inside the caller's own tenant", async () => {
      const rows = await selectRows<{ sessionTenant: string; eventTenant: string }>(
        tenantA,
        `SELECT s.TenantId AS sessionTenant, e.TenantId AS eventTenant ` +
          `FROM ${database}.coding_sessions AS s ` +
          `INNER JOIN ${database}.coding_session_events AS e ON e.SessionId = s.SessionId`,
      );

      expect(rows.length, "the join returned nothing to check tenant scoping on").toBeGreaterThan(
        0,
      );
      expect(new Set(rows.map((row) => row.sessionTenant))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
      expect(new Set(rows.map((row) => row.eventTenant))).toEqual(
        new Set([harness.tenantA.tenantId]),
      );
    });
  });

  describe("when the key-hash context matches no project", () => {
    it("returns zero rows from both coding-agent views, never an error", async () => {
      const noProject = await harness.restrictedClient({ keyHash: "not-a-real-key-hash" });

      expect(
        await selectRows(noProject, `SELECT SessionId FROM ${database}.coding_sessions`),
      ).toHaveLength(0);
      expect(
        await selectRows(noProject, `SELECT SessionId FROM ${database}.coding_session_events`),
      ).toHaveLength(0);
    });
  });
});
