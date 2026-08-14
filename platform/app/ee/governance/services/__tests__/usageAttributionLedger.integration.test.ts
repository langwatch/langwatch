/**
 * @vitest-environment node
 *
 * The report's ledger query is the one part of ADR-094 that unit tests cannot
 * see: the SQL is a string until ClickHouse parses it, the dedup subqueries
 * only matter against a real ReplacingMergeTree with unmerged parts, and the
 * spend join spans two tables whose keys and version columns differ.
 *
 * It also pins the finding that changed the design: `governance_kpis` is
 * written by a reactor on the trace-processing pipeline, so PULLED provider
 * usage — the traffic this ADR exists to attribute — has no KPI row at all and
 * carries its cost inside the OCSF payload. A report that read only
 * `governance_kpis` would report zero for exactly the rows that matter.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { IdentityErasureTokenService } from "~/server/identity-links/erasure-token.service";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { PROJECT_KIND } from "../governanceProject.service";
import { UsageAttributionLedgerClickHouseRepository } from "../usageAttributionLedger.clickhouse.repository";
import { UsageAttributionReportService } from "../usageAttributionReport.service";

const ns = nanoid(8);
const SECRET = "d".repeat(64);
const FROM = new Date("2026-03-01T00:00:00Z");
const TO = new Date("2026-04-01T00:00:00Z");
const IN_WINDOW = new Date("2026-03-10T12:00:00Z");
const OUT_OF_WINDOW = new Date("2026-02-10T12:00:00Z");

let organizationId: string;
let tenantId: string;
let ch: ClickHouseClient;
let repository: UsageAttributionLedgerClickHouseRepository;
let service: UsageAttributionReportService;
let linkedUserId: string;

const SOURCE_ID = `src-${ns}`;

/** Only the fields this suite varies; the rest are the table's own defaults. */
const ocsfRow = ({
  eventId,
  traceId,
  actorUserId = "",
  actorEmail = "",
  actorKind = "person",
  costUsd = 0,
  eventTime = IN_WINDOW,
  lastUpdatedAt = new Date("2026-03-10T12:00:00Z"),
}: {
  eventId: string;
  traceId: string;
  actorUserId?: string;
  actorEmail?: string;
  actorKind?: string;
  costUsd?: number;
  eventTime?: Date;
  lastUpdatedAt?: Date;
}) => ({
  TenantId: tenantId,
  EventId: eventId,
  TraceId: traceId,
  SourceId: SOURCE_ID,
  SourceType: "claude_compliance",
  ClassUid: 6003,
  CategoryUid: 6,
  ActivityId: 6,
  TypeUid: 600306,
  SeverityId: 1,
  EventTime: eventTime,
  ActorUserId: actorUserId,
  ActorEmail: actorEmail,
  ActorEnduserId: "",
  ActionName: "invoke",
  TargetName: "model",
  AnomalyAlertId: "",
  RawOcsfJson: JSON.stringify({
    actor: { user: { uid: actorUserId, type: actorKind, type_id: 1 } },
    metadata: { extension: { cost_usd: costUsd } },
  }),
  LastUpdatedAt: lastUpdatedAt,
});

const kpiRow = ({
  traceId,
  spendUsd,
  hourBucket = new Date("2026-03-10T12:00:00Z"),
  lastEventOccurredAt = new Date("2026-03-10T12:00:00Z"),
}: {
  traceId: string;
  spendUsd: number;
  hourBucket?: Date;
  lastEventOccurredAt?: Date;
}) => ({
  TenantId: tenantId,
  SourceId: SOURCE_ID,
  HourBucket: hourBucket,
  TraceId: traceId,
  SourceType: "claude_compliance",
  SpendUsd: spendUsd,
  PromptTokens: 0,
  CompletionTokens: 0,
  LastEventOccurredAt: lastEventOccurredAt,
});

const insert = async (table: string, values: unknown[]) => {
  await ch.insert({
    table,
    values,
    format: "JSONEachRow",
    // The repositories ship async_insert with no wait; this suite needs the
    // rows visible to the very next query, so it waits.
    clickhouse_settings: { async_insert: 0 },
  });
};

const byTrace = (rows: Awaited<ReturnType<typeof findLedger>>) =>
  Object.fromEntries(rows.map((row) => [row.traceId, row]));

const findLedger = () =>
  repository.findLedger({ tenantId, from: FROM, to: TO });

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("Test ClickHouse client not initialised");
  ch = client;

  const organization = await prisma.organization.create({
    data: { name: "Attribution Org", slug: `--test-org-attr-${ns}` },
  });
  organizationId = organization.id;
  const team = await prisma.team.create({
    data: {
      name: `Attr Team ${ns}`,
      slug: `--test-attr-team-${ns}`,
      organizationId,
    },
  });
  const govProject = await prisma.project.create({
    data: {
      name: "Governance (internal)",
      slug: `governance-attr-${ns}`,
      apiKey: `key-attr-${ns}`,
      teamId: team.id,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      language: "internal",
      framework: "governance",
    },
  });
  tenantId = govProject.id;
  repository = new UsageAttributionLedgerClickHouseRepository(async () => ch);
  service = new UsageAttributionReportService(
    prisma,
    repository,
    new IdentityErasureTokenService(SECRET),
  );

  // The Postgres half the report joins against: the connection the ledger's
  // SourceId names, a member, and the link that makes them the same person.
  const linkedUser = await prisma.user.create({
    data: { name: "Linked Person", email: `linked-${ns}@example.com` },
  });
  linkedUserId = linkedUser.id;
  await prisma.ingestionSource.create({
    data: {
      id: SOURCE_ID,
      organizationId,
      sourceType: "claude_compliance",
      name: `Attr Connection ${ns}`,
      ingestSecretHash: "unused-by-this-suite",
    },
  });
  await prisma.providerIdentityLink.create({
    data: {
      organizationId,
      provider: "anthropic",
      providerConnectionId: SOURCE_ID,
      externalKind: "member_id",
      externalId: "mem-1",
      userId: linkedUserId,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      source: "manual",
      actorUserId: null,
    },
  });

  await insert("governance_ocsf_events", [
    // A PULLED event: cost lives in the payload, and no KPI row will ever
    // exist for it.
    ocsfRow({
      eventId: `pull:evt-1-${ns}`,
      traceId: `pull:evt-1-${ns}`,
      actorUserId: "mem-1",
      actorEmail: "alice@example.com",
      costUsd: 12.5,
    }),
    // A PUSHED trace: EventId = TraceId, cost lives in governance_kpis.
    ocsfRow({
      eventId: `trace-push-${ns}`,
      traceId: `trace-push-${ns}`,
      actorUserId: "mem-2",
      costUsd: 999, // a payload value that must be ignored in favour of the KPI
    }),
    // A pushed trace whose KPI row says zero — an authoritative zero.
    ocsfRow({
      eventId: `trace-zero-${ns}`,
      traceId: `trace-zero-${ns}`,
      actorUserId: "mem-3",
      costUsd: 7, // must NOT be used
    }),
    // A service principal, declared at ingest.
    ocsfRow({
      eventId: `pull:evt-svc-${ns}`,
      traceId: `pull:evt-svc-${ns}`,
      actorUserId: "svc-1",
      actorKind: "service_principal",
      costUsd: 1,
    }),
    // Outside the window entirely.
    ocsfRow({
      eventId: `pull:evt-old-${ns}`,
      traceId: `pull:evt-old-${ns}`,
      actorUserId: "mem-1",
      costUsd: 500,
      eventTime: OUT_OF_WINDOW,
    }),
    // A REPLAY of the first pulled event: same (TenantId, EventId), later
    // LastUpdatedAt, restated cost. Only this version may count.
    ocsfRow({
      eventId: `pull:evt-1-${ns}`,
      traceId: `pull:evt-1-${ns}`,
      actorUserId: "mem-1",
      actorEmail: "alice@example.com",
      costUsd: 20,
      lastUpdatedAt: new Date("2026-03-11T12:00:00Z"),
    }),
  ]);

  await insert("governance_kpis", [
    // The pushed trace, split across two hour buckets — the per-trace spend is
    // the SUM of them, not either one.
    kpiRow({ traceId: `trace-push-${ns}`, spendUsd: 3 }),
    kpiRow({
      traceId: `trace-push-${ns}`,
      spendUsd: 4,
      hourBucket: new Date("2026-03-10T13:00:00Z"),
      lastEventOccurredAt: new Date("2026-03-10T13:00:00Z"),
    }),
    // A replayed KPI contribution for that first bucket: same key, later
    // version, restated value. Without the dedup this inflates the total.
    kpiRow({
      traceId: `trace-push-${ns}`,
      spendUsd: 5,
      lastEventOccurredAt: new Date("2026-03-12T12:00:00Z"),
    }),
    // A byte-identical re-delivery of the FIRST bucket's contribution. Its
    // version is `LastEventOccurredAt`, which the reactor takes from the
    // trace's own occurredAt — a fact about the data, not a clock — so a
    // replay ties rather than advancing. The IN-tuple dedup admits both rows
    // of a tie and sums them; only picking one per key survives this.
    kpiRow({
      traceId: `trace-push-${ns}`,
      spendUsd: 5,
      lastEventOccurredAt: new Date("2026-03-12T12:00:00Z"),
    }),
    kpiRow({ traceId: `trace-zero-${ns}`, spendUsd: 0 }),
  ]);
});

afterAll(async () => {
  await ch
    .command({
      query: `DELETE FROM governance_ocsf_events WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    })
    .catch(() => {});
  await ch
    .command({
      query: `DELETE FROM governance_kpis WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    })
    .catch(() => {});
  await cleanupTestRows(prisma, [
    ["providerIdentityLink", { organizationId }],
    ["ingestionSource", { organizationId }],
    ["project", { team: { organizationId } }],
    ["team", { organizationId }],
    ["organization", { id: organizationId }],
    ["user", { id: linkedUserId }],
  ]);
});

describe("UsageAttributionLedgerClickHouseRepository against real ClickHouse", () => {
  it("returns one group per (login, trace) inside the window", async () => {
    const rows = await findLedger();
    expect(rows.map((row) => row.traceId).sort()).toEqual(
      [
        `pull:evt-1-${ns}`,
        `pull:evt-svc-${ns}`,
        `trace-push-${ns}`,
        `trace-zero-${ns}`,
      ].sort(),
    );
  });

  describe("given a pulled event with no KPI row", () => {
    it("takes its spend from the OCSF payload", async () => {
      const rows = byTrace(await findLedger());
      // The RESTATED value, not the original — see the dedup test below.
      expect(rows[`pull:evt-1-${ns}`]!.spendUsd).toBeCloseTo(20, 6);
    });
  });

  describe("given a pushed trace with KPI rows", () => {
    it("sums them, and ignores the payload's own number", async () => {
      const rows = byTrace(await findLedger());
      // 5 (the restated first bucket) + 4 (the second) — never 3 + 4 + 5, and
      // never the payload's 999.
      expect(rows[`trace-push-${ns}`]!.spendUsd).toBeCloseTo(9, 6);
    });

    describe("and the KPI rows sum to zero", () => {
      // Precedence is "a KPI row exists", not "the KPI spend is nonzero".
      // Falling through to the payload here would silently mix two sources in
      // one report and put 7 dollars nobody spent onto somebody's name.
      it("reports zero rather than falling back to the payload", async () => {
        const rows = byTrace(await findLedger());
        expect(rows[`trace-zero-${ns}`]!.spendUsd).toBe(0);
      });
    });
  });

  describe("given a replayed event still sitting unmerged", () => {
    it("counts it once, at its latest version", async () => {
      const rows = byTrace(await findLedger());
      expect(rows[`pull:evt-1-${ns}`]!.events).toBe(1);
    });

    describe("and the replay's version TIES rather than advancing", () => {
      // The version comes from the trace's own occurredAt, so a re-delivered
      // reactor event writes an identical row with an identical version. A
      // dedup that keeps "every row at the max version" keeps both of them.
      it("still counts the trace's spend once", async () => {
        const rows = byTrace(await findLedger());
        // 5 (the first bucket, whichever of the two tied copies wins) + 4
        // (the second bucket). Never 5 + 5 + 4.
        expect(rows[`trace-push-${ns}`]!.spendUsd).toBeCloseTo(9, 6);
      });
    });
  });

  it("carries the ingest-time actor kind out of the payload", async () => {
    const rows = byTrace(await findLedger());
    expect(rows[`pull:evt-svc-${ns}`]!.actorType).toBe("service_principal");
    expect(rows[`pull:evt-1-${ns}`]!.actorType).toBe("person");
    expect(rows[`pull:evt-1-${ns}`]!.actorEmail).toBe("alice@example.com");
    expect(rows[`pull:evt-1-${ns}`]!.actorUserId).toBe("mem-1");
  });

  it("excludes events outside the window, cost and all", async () => {
    const rows = await findLedger();
    expect(rows.some((row) => row.traceId === `pull:evt-old-${ns}`)).toBe(
      false,
    );
    const total = rows.reduce((sum, row) => sum + row.spendUsd, 0);
    expect(total).toBeCloseTo(20 + 9 + 0 + 1, 6);
  });

  it("attributes each group at its first event", async () => {
    const rows = byTrace(await findLedger());
    expect(rows[`pull:evt-1-${ns}`]!.firstEventMs).toBe(IN_WINDOW.getTime());
  });
});

describe("the report's totals conserve (ADR-094 Invariants)", () => {
  /**
   * The invariant, asserted the only way that actually proves it: against a
   * SEPARATE raw query that knows nothing about buckets, links or people. If
   * the bucketing ever drops a row — the failure mode the ADR names, because
   * it is invisible — these two numbers stop agreeing.
   */
  const rawLedgerTotals = async () => {
    const result = await ch.query({
      query: `
        SELECT
          toString(count()) AS events,
          toString(sum(cost)) AS spend
        FROM (
          SELECT JSONExtractFloat(RawOcsfJson, 'metadata', 'extension', 'cost_usd') AS cost
          FROM governance_ocsf_events
          WHERE TenantId = {tenantId:String}
            AND EventTime >= fromUnixTimestamp64Milli({fromMs:UInt64})
            AND EventTime < fromUnixTimestamp64Milli({toMs:UInt64})
            AND (TenantId, EventId, LastUpdatedAt) IN (
              SELECT TenantId, EventId, max(LastUpdatedAt)
              FROM governance_ocsf_events
              WHERE TenantId = {tenantId:String}
                AND EventTime >= fromUnixTimestamp64Milli({fromMs:UInt64})
                AND EventTime < fromUnixTimestamp64Milli({toMs:UInt64})
              GROUP BY TenantId, EventId
            )
        )
      `,
      query_params: {
        tenantId,
        fromMs: FROM.getTime(),
        toMs: TO.getTime(),
      },
      format: "JSONEachRow",
    });
    const [row] = (await result.json()) as Array<{
      events: string;
      spend: string;
    }>;
    return { events: Number(row!.events), spend: Number(row!.spend) };
  };

  it("counts every ledger event exactly once across the three buckets", async () => {
    const [report, raw] = await Promise.all([
      service.report({ organizationId, tenantId, from: FROM, to: TO }),
      rawLedgerTotals(),
    ]);

    const { attributed, unattributed, unattributable, ledger } = report.totals;
    expect(
      attributed.events + unattributed.events + unattributable.events,
    ).toBe(raw.events);
    expect(ledger.events).toBe(raw.events);
  });

  it("places the money in the buckets the links and the ingest marks dictate", async () => {
    const report = await service.report({
      organizationId,
      tenantId,
      from: FROM,
      to: TO,
    });

    // mem-1 is linked to the test person: the restated 20 dollars.
    expect(report.totals.attributed.spendUsd).toBeCloseTo(20, 6);
    // The declared service principal, whatever its cost.
    expect(report.totals.unattributable.spendUsd).toBeCloseTo(1, 6);
    // mem-2 (9) and mem-3 (0) are person-kind and unlinked.
    expect(report.totals.unattributed.spendUsd).toBeCloseTo(9, 6);
    expect(report.totals.ledger.spendUsd).toBeCloseTo(30, 6);

    const attributedRow = report.rows.find(
      (row) => row.bucket === "attributed",
    );
    expect(attributedRow?.displayName).toBe("Linked Person");
  });
});
