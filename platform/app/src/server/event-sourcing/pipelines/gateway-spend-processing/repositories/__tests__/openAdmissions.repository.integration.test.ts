/**
 * The settlement sweeper's read side, against real ClickHouse.
 *
 * The sweeper no longer remembers anything: a cleared wake, a wake never
 * armed, and a duplicate wake are all one behavior of this query now — a
 * request it does not select. The fold writes one ReplacingMergeTree version
 * per lifecycle transition, so a request that resolved still has its
 * superseded `admitted` version on disk, and a read that saw it would settle
 * a live request and ship a spurious `gateway.request.settled`. Nothing but
 * a real ClickHouse can state whether the collapse to the latest version
 * actually happens, so this suite is where those scenarios live.
 *
 * The query is cross-tenant BY DESIGN (settlement is install-wide), so the
 * usual `WHERE TenantId =` isolation is unavailable to it. Two things stand
 * in for it: every fixture carries a per-run tenant id that the assertions
 * filter on, and both windows sit in months no other spend fixture writes
 * to, so a foreign row cannot enter the window the sweep is given.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../process-manager/spendSettlement.process";
import type { GatewaySpendState } from "../../projections/gatewaySpend.foldProjection";
import {
  ClickHouseOpenAdmissionFinder,
  type OpenAdmission,
} from "../openAdmissions.clickhouse.repository";

const run = nanoid(8);
const tenantId = `open-admissions-${run}`;

/** April 2026 for the behavior fixtures, May 2026 for the cap: months no
 *  other gateway_spend fixture writes to, which is what keeps a
 *  deliberately cross-tenant read exact. */
const BASE = Date.UTC(2026, 3, 6, 8, 0, 0);
const CAP_BASE = Date.UTC(2026, 4, 11, 3, 0, 0);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** now - graceMs = BASE + 1h, so BASE..BASE+10m is past grace and
 *  BASE+90m is still inside it. now - lookbackMs = BASE - 1h. */
const SWEEP = { now: BASE + 2 * HOUR, graceMs: HOUR, lookbackMs: 3 * HOUR };

let client: ClickHouseClient;
let repo: GatewaySpendEventsRepository;
let finder: ClickHouseOpenAdmissionFinder;

function foldState({
  status,
  occurredAtMs,
  updatedAt,
}: {
  status: GatewaySpendState["status"];
  occurredAtMs: number;
  updatedAt: number;
}): GatewaySpendState {
  return {
    status,
    organizationId: `org-${run}`,
    virtualKeyId: `vk-${run}`,
    principalUserId: `user-${run}`,
    endUserId: `end-user-${run}`,
    model: "openai/gpt-5-mini",
    providerKey: `prov-${run}`,
    traceId: `trace-${run}`,
    requestType: "chat",
    labels: ["env:prod"],
    metadataJson: '{"team":"billing"}',
    podId: `pod-${run}`,
    podSeq: 1,
    usage: null,
    rateVersion: "",
    costNanoUsd: 0,
    errorType: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs,
    durationMs: 0,
    createdAt: occurredAtMs,
    updatedAt,
    LastEventOccurredAt: occurredAtMs,
  };
}

/** One fold commit. Separate calls on purpose where a request has more than
 *  one version, so the superseded row lands as its own part rather than
 *  being collapsed inside a single insert block. */
async function fold(
  gatewayRequestId: string,
  state: GatewaySpendState,
): Promise<void> {
  await repo.upsertFromFold([{ tenantId, gatewayRequestId, state }]);
}

const id = (name: string) => `req-${name}-${run}`;

const OPEN_OLDEST = id("open-oldest");
const OPEN_MIDDLE = id("open-middle");
const OPEN_NEWEST = id("open-newest");
const REWRITTEN = id("rewritten");
const CONFIRMED = id("confirmed");
const INSIDE_GRACE = id("inside-grace");
const BEFORE_LOOKBACK = id("before-lookback");
const FAILED = id("failed");
const ALREADY_SETTLED = id("already-settled");

beforeAll(async () => {
  const containers = await startTestContainers();
  client = containers.clickHouseClient;
  repo = new GatewaySpendEventsRepository(async () => client);
  finder = new ClickHouseOpenAdmissionFinder(client);
  // The superseded versions are the whole point of the dedup scenarios, and a
  // background merge collapses them on its own schedule — which would leave
  // those tests passing for a reason the query had no part in. The writer's
  // `wait_for_async_insert` already guarantees one block per fold commit;
  // holding merges off keeps both blocks on disk until the query has read
  // them, so what collapses the versions here is the query and nothing else.
  await client.command({ query: "SYSTEM STOP MERGES gateway_spend" });
}, 120_000);

afterAll(async () => {
  if (client) {
    await client.command({ query: "SYSTEM START MERGES gateway_spend" });
    await client.command({
      query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenantId}'`,
    });
  }
  await stopTestContainers();
});

describe("open admissions on the spend record (real ClickHouse)", () => {
  describe("given a window of folded rows across every lifecycle status", () => {
    let open: OpenAdmission[];

    beforeAll(async () => {
      // Three admissions past their grace, out of time order on the wire so
      // an ordering assertion cannot pass on insertion order alone.
      await fold(
        OPEN_MIDDLE,
        foldState({
          status: "admitted",
          occurredAtMs: BASE + 5 * MINUTE,
          updatedAt: BASE + 5 * MINUTE,
        }),
      );
      await fold(
        OPEN_NEWEST,
        foldState({
          status: "admitted",
          occurredAtMs: BASE + 10 * MINUTE,
          updatedAt: BASE + 10 * MINUTE,
        }),
      );
      await fold(
        OPEN_OLDEST,
        foldState({
          status: "admitted",
          occurredAtMs: BASE,
          updatedAt: BASE,
        }),
      );

      // Rewritten before any outcome: two `admitted` versions of one request.
      await fold(
        REWRITTEN,
        foldState({
          status: "admitted",
          occurredAtMs: BASE + 2 * MINUTE,
          updatedAt: BASE + 2 * MINUTE,
        }),
      );
      await fold(
        REWRITTEN,
        foldState({
          status: "admitted",
          occurredAtMs: BASE + 2 * MINUTE,
          updatedAt: BASE + 3 * MINUTE,
        }),
      );

      // Confirmed past its grace: the superseded `admitted` version stays on
      // disk, and settling it would bill a request that already resolved.
      await fold(
        CONFIRMED,
        foldState({
          status: "admitted",
          occurredAtMs: BASE + 4 * MINUTE,
          updatedAt: BASE + 4 * MINUTE,
        }),
      );
      await fold(
        CONFIRMED,
        foldState({
          status: "confirmed",
          occurredAtMs: BASE + 4 * MINUTE,
          updatedAt: BASE + 6 * MINUTE,
        }),
      );

      // Terminal statuses that are not `confirmed`. A settled row re-swept
      // would settle forever.
      await fold(
        FAILED,
        foldState({
          status: "failed",
          occurredAtMs: BASE + 7 * MINUTE,
          updatedAt: BASE + 7 * MINUTE,
        }),
      );
      await fold(
        ALREADY_SETTLED,
        foldState({
          status: "settled",
          occurredAtMs: BASE + 8 * MINUTE,
          updatedAt: BASE + 8 * MINUTE,
        }),
      );

      // Out of window on either side.
      await fold(
        INSIDE_GRACE,
        foldState({
          status: "admitted",
          occurredAtMs: BASE + 90 * MINUTE,
          updatedAt: BASE + 90 * MINUTE,
        }),
      );
      await fold(
        BEFORE_LOOKBACK,
        foldState({
          status: "admitted",
          occurredAtMs: BASE - 2 * HOUR,
          updatedAt: BASE - 2 * HOUR,
        }),
      );

      open = (await finder.findOpenAdmissions(SWEEP)).filter(
        (row) => row.tenantId === tenantId,
      );
    }, 120_000);

    describe("when the sweeper reads the open admissions", () => {
      /** @scenario A confirmation stands the sweeper down */
      it("leaves out a request whose confirmation superseded its admission", () => {
        expect(open.map((row) => row.gatewayRequestId)).not.toContain(
          CONFIRMED,
        );
      });

      /** @scenario An admission inside its grace is not open yet */
      it("leaves out an admission whose grace has not elapsed", () => {
        expect(open.map((row) => row.gatewayRequestId)).not.toContain(
          INSIDE_GRACE,
        );
      });

      /** @scenario A rewritten admission is offered once, not once per version */
      it("offers a twice-written admission a single time", () => {
        const offered = open.filter(
          (row) => row.gatewayRequestId === REWRITTEN,
        );
        expect(offered).toHaveLength(1);
      });

      /** @scenario A request that already reached a terminal status is never swept again */
      it("leaves out failed and already-settled requests", () => {
        const ids = open.map((row) => row.gatewayRequestId);
        expect(ids).not.toContain(FAILED);
        expect(ids).not.toContain(ALREADY_SETTLED);
      });

      /** @scenario An admission older than the lookback is left where it is */
      it("leaves out an admission older than the lookback", () => {
        expect(open.map((row) => row.gatewayRequestId)).not.toContain(
          BEFORE_LOOKBACK,
        );
      });

      // Exact, not `toContain`: anything selected here becomes a settle
      // command, so an extra row is the failure this suite exists to catch.
      it("returns exactly the open admissions, oldest first", () => {
        expect(open.map((row) => row.gatewayRequestId)).toEqual([
          OPEN_OLDEST,
          REWRITTEN,
          OPEN_MIDDLE,
          OPEN_NEWEST,
        ]);
      });

      it("carries the attribution the fold recorded, so the settle command can name it", () => {
        const oldest = open[0]!;
        expect(oldest).toMatchObject({
          gatewayRequestId: OPEN_OLDEST,
          organizationId: `org-${run}`,
          virtualKeyId: `vk-${run}`,
          principalUserId: `user-${run}`,
          endUserId: `end-user-${run}`,
          traceId: `trace-${run}`,
          requestType: "chat",
          labels: ["env:prod"],
          metadata: '{"team":"billing"}',
          model: "openai/gpt-5-mini",
          providerKey: `prov-${run}`,
          admittedAtMs: BASE,
        });
      });
    });
  });

  describe("given more open admissions than one sweep may settle", () => {
    const capNewest = id("cap-newest");
    let open: OpenAdmission[];

    beforeAll(async () => {
      // One more than the cap, a millisecond apart, so the row the cap must
      // shed is unambiguous: the newest one. Milliseconds keep the whole
      // fixture inside the hour the sweep is given to look at.
      const entries = Array.from(
        { length: MAX_OPEN_ADMISSIONS_PER_SWEEP + 1 },
        (_, i) => ({
          tenantId,
          gatewayRequestId:
            i === MAX_OPEN_ADMISSIONS_PER_SWEEP
              ? capNewest
              : `req-cap-${i}-${run}`,
          state: foldState({
            status: "admitted",
            occurredAtMs: CAP_BASE + i,
            updatedAt: CAP_BASE + i,
          }),
        }),
      );
      for (let i = 0; i < entries.length; i += 2500) {
        await repo.upsertFromFold(entries.slice(i, i + 2500));
      }
      open = await finder.findOpenAdmissions({
        now: CAP_BASE + 2 * HOUR,
        graceMs: HOUR,
        lookbackMs: 3 * HOUR,
      });
    }, 180_000);

    describe("when the sweeper reads the open admissions", () => {
      /** @scenario The sweep reads the oldest admissions first, up to its cap */
      it("returns the cap's worth, oldest first, leaving the newest for the next sweep", () => {
        expect(open).toHaveLength(MAX_OPEN_ADMISSIONS_PER_SWEEP);
        const ids = open.map((row) => row.gatewayRequestId);
        expect(ids).toContain(`req-cap-0-${run}`);
        expect(ids).not.toContain(capNewest);
        const times = open.map((row) => row.admittedAtMs);
        expect(times).toEqual([...times].sort((a, b) => a - b));
      });
    });
  });
});
