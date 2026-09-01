// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The seat read against a real ClickHouse.
 *
 * `findLatestSeatReports` is a query, and a query's answer is decided by the
 * server rather than by the string. The unit tests beside this file drive a
 * fake client: they pin what the repository does with rows it is handed, and
 * they cannot see whether the SQL that produced those rows picked the right
 * ones. Two clauses are only decidable with the engine underneath —
 * `toDate(max(EventTime))`, which chooses the day a pool reports on, and
 * `argMax(RawOcsfJson, (EventTime, LastUpdatedAt))`, which chooses WHICH
 * recording of that day wins when the licence list was read twice.
 *
 * The second has a deadline attached. The table is a
 * ReplacingMergeTree(LastUpdatedAt) keyed on (TenantId, EventId), so the two
 * recordings of a re-read day are two rows until a merge collapses them into
 * one. A read that let the merge pick the winner would answer differently
 * depending on whether it happened to run before or after it, so the
 * compaction is forced here and the same question asked on both sides of it.
 *
 * The payloads come from the production seat-event builder
 * (`microsoftSeatEvents`), so the bag the counts travel in is the real one.
 * Only the OCSF envelope around it is rebuilt locally: the puller worker's
 * mapper is module-private, and the envelope has its own coverage in
 * pullers/__tests__/pullerWorker.ocsfMapping.unit.test.ts.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *       §"The seat lane reads the newest report of each pool, and nobody else's"
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";

import {
  type GovernanceOcsfEventInput,
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";
import {
  microsoftSeatEvents,
  SEAT_REPORT_ACTION,
  type SubscribedSku,
} from "../pullers/microsoftGraphSeats";

const TABLE = "governance_ocsf_events";
const SOURCE_TYPE = "copilot_studio";
const SOURCE_ID = "is-seatread";

/** A paid, per-person, live agent pool — what the screen counts as seats. */
const PAID_POOL = "POWER_VIRTUAL_AGENTS_USL";
/** Company-wide, free and suspended at once — none of the four facts hold. */
const TRIAL_POOL = "MICROSOFT_365_E5_TRIAL";

let ch: ClickHouseClient;
let repository: GovernanceOcsfEventsClickHouseRepository;
let tenantId: string;

/** Every tenant this file wrote under, so afterAll can take them all out. */
const tenantsWritten: string[] = [];

function freshTenant(): string {
  // The table is shared and OPTIMIZE ... FINAL is table-wide, so a test that
  // compacts must not be able to see another test's rows.
  const id = `gov-seatread-${nanoid(8)}`;
  tenantsWritten.push(id);
  return id;
}

function sku({
  skuId,
  partNumber,
  appliesTo = "User",
  capabilityStatus = "Enabled",
  consumedUnits,
  enabled,
  warning = 0,
  suspended = 0,
}: {
  skuId: string;
  partNumber: string;
  appliesTo?: string;
  capabilityStatus?: string;
  consumedUnits: number;
  enabled: number;
  warning?: number;
  suspended?: number;
}): SubscribedSku {
  return {
    skuId,
    skuPartNumber: partNumber,
    appliesTo,
    capabilityStatus,
    consumedUnits,
    prepaidUnits: { enabled, warning, suspended },
  };
}

/**
 * The OCSF rows a licence read writes, built from the production seat events.
 *
 * The identity is the pool and the day — `source_event_id` carries both — so
 * two reads of one day produce the same EventId and land on each other rather
 * than beside each other. That is why the argMax has anything to decide.
 */
function seatRowsFor({
  skus,
  day,
  tenant,
}: {
  skus: SubscribedSku[];
  day: string;
  tenant?: string;
}): GovernanceOcsfEventInput[] {
  return microsoftSeatEvents({ skus, day }).map((event) => {
    const eventId = `${SOURCE_TYPE}:${SOURCE_ID}:${event.source_event_id}`;
    return {
      tenantId: tenant ?? tenantId,
      eventId,
      traceId: `pull:${eventId}`,
      sourceId: SOURCE_ID,
      sourceType: SOURCE_TYPE,
      activityId: OCSF_ACTIVITY.INVOKE,
      severityId: OCSF_SEVERITY.INFO,
      eventTime: new Date(event.event_timestamp),
      actorUserId: "",
      actorEmail: event.actor,
      actorEnduserId: "",
      actionName: event.action,
      targetName: event.target,
      anomalyAlertId: "",
      rawOcsfJson: JSON.stringify({
        class_uid: 6003,
        category_uid: 6,
        activity_id: OCSF_ACTIVITY.INVOKE,
        severity_id: OCSF_SEVERITY.INFO,
        api: { operation: event.action },
        dst_endpoint: { name: event.target },
        metadata: {
          product: { name: "LangWatch", vendor_name: "LangWatch" },
          extension: {
            uid: "langwatch.governance",
            source_type: SOURCE_TYPE,
            source_id: SOURCE_ID,
            ingest_mode: "pull",
            cost_usd: event.cost_usd,
            tokens_input: event.tokens_input,
            tokens_output: event.tokens_output,
            raw_event: event.raw_payload,
            ...(event.extra ?? {}),
          },
        },
      }),
    };
  });
}

async function write(rows: GovernanceOcsfEventInput[]): Promise<void> {
  for (const row of rows) {
    await repository.insertEvent(row);
  }
}

/** How many rows the table physically holds for a tenant, duplicates included. */
async function rawRowCount(tenant: string): Promise<number> {
  const result = await ch.query({
    query: `SELECT count() AS N FROM ${TABLE} WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId: tenant },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ N: unknown }>;
  return Number(rows[0]?.N ?? 0);
}

/**
 * The production write path uses `async_insert` without waiting, so a row is
 * accepted before it is readable. Poll rather than sleep: a fixed wait is
 * either longer than it needs to be or shorter than a loaded server needs.
 */
async function settled({
  tenant,
  rows,
}: {
  tenant: string;
  rows: number;
}): Promise<void> {
  await vi.waitFor(
    async () => {
      const readable = await rawRowCount(tenant);
      if (readable !== rows) {
        throw new Error(
          `${tenant}: ${readable} of ${rows} written rows are readable so far`,
        );
      }
    },
    { timeout: 20_000, interval: 100 },
  );
}

/**
 * One row written straight to the table, for fixtures the write path cannot
 * express.
 *
 * `LastUpdatedAt` is what separates two recordings of one day, and
 * `insertEvent` leaves it to the column default, so a test that needs two
 * KNOWN versions has to state them. Written synchronously, so it is readable
 * once this resolves.
 */
async function writeRaw(row: Record<string, unknown>): Promise<void> {
  await ch.insert({ table: TABLE, values: [row], format: "JSONEachRow" });
}

function rawSeatRow({
  tenant,
  targetName,
  day,
  rawOcsfJson,
  lastUpdatedAt,
  actionName = SEAT_REPORT_ACTION,
}: {
  tenant: string;
  targetName: string;
  day: string;
  rawOcsfJson: string;
  lastUpdatedAt: string;
  actionName?: string;
}): Record<string, unknown> {
  return {
    TenantId: tenant,
    // Pool and day, the same identity the builder composes, so two recordings
    // of one day collapse onto each other exactly as production's would.
    EventId: `${SOURCE_TYPE}:${SOURCE_ID}:msgraph_seats:${targetName}:${day}`,
    TraceId: `pull:${targetName}:${day}`,
    SourceId: SOURCE_ID,
    SourceType: SOURCE_TYPE,
    ClassUid: 6003,
    CategoryUid: 6,
    ActivityId: OCSF_ACTIVITY.INVOKE,
    TypeUid: 6003 * 100 + OCSF_ACTIVITY.INVOKE,
    SeverityId: OCSF_SEVERITY.INFO,
    EventTime: `${day}T00:00:00.000Z`,
    ActorUserId: "",
    ActorEmail: "",
    ActorEnduserId: "",
    ActionName: actionName,
    TargetName: targetName,
    AnomalyAlertId: "",
    RawOcsfJson: rawOcsfJson,
    LastUpdatedAt: lastUpdatedAt,
  };
}

/** A seat payload stated directly, for rows written outside the builder. */
function seatPayload(extension: Record<string, unknown>): string {
  return JSON.stringify({
    class_uid: 6003,
    api: { operation: SEAT_REPORT_ACTION },
    metadata: {
      product: { name: "LangWatch", vendor_name: "LangWatch" },
      extension: {
        uid: "langwatch.governance",
        ingest_mode: "pull",
        cost_usd: "0",
        ...extension,
      },
    },
  });
}

async function compact(): Promise<void> {
  await ch.command({ query: `OPTIMIZE TABLE ${TABLE} FINAL` });
}

describe("the seat read against real ClickHouse", () => {
  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
  });

  beforeEach(() => {
    tenantId = freshTenant();
    repository = new GovernanceOcsfEventsClickHouseRepository(async () => ch);
  });

  afterAll(async () => {
    for (const tenant of tenantsWritten) {
      await ch
        ?.command({
          query: `DELETE FROM ${TABLE} WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId: tenant },
        })
        .catch(() => undefined);
    }
  });

  describe("given a pool recorded on more than one day", () => {
    /** @scenario "A pool that was read on several days reports its newest day only" */
    it("returns the pool once, dated and counted by its newest day", async () => {
      await write(
        seatRowsFor({
          day: "2026-08-20",
          skus: [
            sku({
              skuId: "sku-agent",
              partNumber: PAID_POOL,
              consumedUnits: 3,
              enabled: 10,
            }),
          ],
        }),
      );
      await write(
        seatRowsFor({
          day: "2026-08-30",
          skus: [
            sku({
              skuId: "sku-agent",
              partNumber: PAID_POOL,
              consumedUnits: 5,
              enabled: 12,
            }),
          ],
        }),
      );
      await settled({ tenant: tenantId, rows: 2 });

      const rows = await repository.findLatestSeatReports({ tenantId });

      // The read dates a pool with toDate() in the SERVER's timezone, UTC on
      // the test container and in CI. A ClickHouse on another timezone would
      // shift a midnight-stamped seat event by a day, and this is the
      // assertion that would say so.
      expect(rows).toEqual([
        {
          sourceId: SOURCE_ID,
          skuPartNumber: PAID_POOL,
          day: "2026-08-30",
          seatsBought: 12,
          seatsAssigned: 5,
          perPerson: true,
          live: true,
          free: false,
          seatStem: true,
        },
      ]);
    });
  });

  describe("given a day recorded twice, separated only by when it was written", () => {
    /** @scenario "A day read twice answers the same before and after a compaction" */
    it("reports the newer recording both before and after the store compacts", async () => {
      const pool = {
        tenant: tenantId,
        targetName: PAID_POOL,
        day: "2026-08-30",
      };

      // The NEWER version goes in FIRST, so nothing about this passing can be
      // explained by insertion order: only LastUpdatedAt separates the two.
      await writeRaw(
        rawSeatRow({
          ...pool,
          lastUpdatedAt: "2026-08-30 18:00:00.000",
          rawOcsfJson: seatPayload({
            skuPartNumber: PAID_POOL,
            seatsBought: 12,
            seatsAssigned: 5,
            perPerson: true,
            live: true,
            free: false,
            seatStem: true,
          }),
        }),
      );
      await writeRaw(
        rawSeatRow({
          ...pool,
          lastUpdatedAt: "2026-08-30 09:00:00.000",
          rawOcsfJson: seatPayload({
            skuPartNumber: PAID_POOL,
            seatsBought: 4,
            seatsAssigned: 1,
            perPerson: true,
            live: true,
            free: false,
            seatStem: true,
          }),
        }),
      );

      // Both versions are physically present, so the question the argMax
      // exists to answer is actually being asked.
      expect(await rawRowCount(tenantId)).toBe(2);

      const beforeCompaction = await repository.findLatestSeatReports({
        tenantId,
      });
      expect(beforeCompaction).toHaveLength(1);
      expect(beforeCompaction[0]?.seatsBought).toBe(12);
      expect(beforeCompaction[0]?.seatsAssigned).toBe(5);

      await compact();
      expect(await rawRowCount(tenantId)).toBe(1);

      const afterCompaction = await repository.findLatestSeatReports({
        tenantId,
      });
      expect(afterCompaction).toEqual(beforeCompaction);
    });
  });

  describe("given another tenant and records that are not licence reports", () => {
    /** @scenario "A read carries no pool belonging to another tenant or another kind of record" */
    it("returns this tenants licence pools and nothing else", async () => {
      const otherTenant = freshTenant();

      await write(
        seatRowsFor({
          day: "2026-08-30",
          skus: [
            sku({
              skuId: "sku-agent",
              partNumber: PAID_POOL,
              consumedUnits: 5,
              enabled: 12,
            }),
          ],
        }),
      );
      // Same pool name, same source, a different tenant.
      await write(
        seatRowsFor({
          tenant: otherTenant,
          day: "2026-08-30",
          skus: [
            sku({
              skuId: "sku-agent",
              partNumber: PAID_POOL,
              consumedUnits: 99,
              enabled: 400,
            }),
          ],
        }),
      );
      // A conversation carrying a payload that WOULD decode as seats. Only
      // ActionName keeps it off the licence list, which is what this pins.
      await writeRaw(
        rawSeatRow({
          tenant: tenantId,
          targetName: "gpt-5-mini",
          day: "2026-08-30",
          actionName: "completion",
          lastUpdatedAt: "2026-08-30 12:00:00.000",
          rawOcsfJson: seatPayload({
            seatsBought: 777,
            seatsAssigned: 777,
            perPerson: true,
            live: true,
            free: false,
            seatStem: true,
          }),
        }),
      );
      await settled({ tenant: tenantId, rows: 2 });
      await settled({ tenant: otherTenant, rows: 1 });

      const mine = await repository.findLatestSeatReports({ tenantId });
      const theirs = await repository.findLatestSeatReports({
        tenantId: otherTenant,
      });

      expect(mine).toEqual([
        {
          sourceId: SOURCE_ID,
          skuPartNumber: PAID_POOL,
          day: "2026-08-30",
          seatsBought: 12,
          seatsAssigned: 5,
          perPerson: true,
          live: true,
          free: false,
          seatStem: true,
        },
      ]);
      // The guard holds in the other direction too, so a query that ignored
      // TenantId altogether could not pass by symmetry.
      expect(theirs.map((row) => row.seatsBought)).toEqual([400]);
    });
  });

  describe("given a licence list holding one pool nothing can read", () => {
    /** @scenario "A pool whose recorded payload cannot be read costs only that pool" */
    it("returns the readable pools with their facts and omits the unreadable one", async () => {
      await write(
        seatRowsFor({
          day: "2026-08-30",
          skus: [
            sku({
              skuId: "sku-agent",
              partNumber: PAID_POOL,
              consumedUnits: 5,
              enabled: 12,
              warning: 2,
              suspended: 7,
            }),
            // Company-wide, free and suspended at once — the four facts have
            // to travel independently or this pool cannot be described.
            sku({
              skuId: "sku-trial",
              partNumber: TRIAL_POOL,
              appliesTo: "Company",
              capabilityStatus: "Suspended",
              consumedUnits: 0,
              enabled: 10_000,
            }),
          ],
        }),
      );
      await writeRaw(
        rawSeatRow({
          tenant: tenantId,
          targetName: "UNREADABLE_POOL",
          day: "2026-08-30",
          lastUpdatedAt: "2026-08-30 12:00:00.000",
          rawOcsfJson: "{not json",
        }),
      );
      await settled({ tenant: tenantId, rows: 3 });

      const rows = await repository.findLatestSeatReports({ tenantId });

      expect(rows.map((row) => row.skuPartNumber)).toEqual([
        TRIAL_POOL,
        PAID_POOL,
      ]);
      expect(rows[0]).toMatchObject({
        seatsBought: 10_000,
        seatsAssigned: 0,
        perPerson: false,
        live: false,
        free: true,
        seatStem: false,
      });
      // Suspended units are not bought: 12 enabled plus 2 in grace, never the
      // 7 frozen ones.
      expect(rows[1]).toMatchObject({
        seatsBought: 14,
        seatsAssigned: 5,
        perPerson: true,
        live: true,
        free: false,
        seatStem: true,
      });
      // Absent, not zeroed: a zero here is a number a summary would honour.
      expect(rows.some((row) => row.skuPartNumber === "UNREADABLE_POOL")).toBe(
        false,
      );
    });
  });
});
