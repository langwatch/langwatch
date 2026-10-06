// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Erasing a provider-named person over a real ClickHouse: the daily cost rows are removed and
 * rebuilt under the stand-in, and the note of each pulled charge follows. The fold, its store,
 * the erasure repository and the erasure service are the real ones; the recorded events stand
 * in for the event log the rebuild reads.
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import {
  type PulledUsageObservedEvent,
  pulledUsageObservedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import { createTenantId } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { observed } from "../../eventing/__tests__/governance-cost-rollup.fixtures.ts";
import { GovernanceCostChargeMapProjection } from "../../eventing/governance-cost-charge.projection.ts";
import { GovernanceCostRollupFoldProjection } from "../../eventing/governance-cost-rollup.projection.ts";
import { GovernanceCostRollupStore } from "../../eventing/governance-cost-rollup.store.ts";
import { ClickHouseGovernanceCostChargeRepository } from "../../repositories/clickhouse/clickhouse.governance-cost-charge.repository.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../../repositories/clickhouse/clickhouse.governance-cost-rollup.repository.ts";
import { ClickHouseRollupErasureRepository } from "../../repositories/clickhouse/clickhouse.rollup-erasure.repository.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { erasureDigest } from "../../rules/erasure-digest.rules.ts";
import { ErasureSuppressionService } from "../erasure-suppression.service.ts";
import { IdentityErasureService } from "../identity-erasure.service.ts";
import { SuppressionSnapshotService } from "../suppression-snapshot.service.ts";

const SECRET = "c".repeat(32);
const FIRST_DAY = "2026-08-20";
const SECOND_DAY = "2026-08-21";
const FIRST_DAY_MS = Date.UTC(2026, 7, 20, 10);
const SECOND_DAY_MS = Date.UTC(2026, 7, 21, 10);
const ERASED_AT = Temporal.Instant.from("2026-09-02T00:00:00Z");

let clickhouse: ClickHouseClient;
let rollup: ClickHouseGovernanceCostRollupRepository;
let charges: ClickHouseGovernanceCostChargeRepository;
let rollupErasure: ClickHouseRollupErasureRepository;

function queryClient(raw: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await raw.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("the rollup erasure never inserts")),
    async command(request) {
      await raw.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
  return new ClickHouseQueryClient({ driver });
}

/** One organization's governance area, holding an observed spend per day for two spenders. */
async function worldWithSpend() {
  const id = nanoid(8);
  const tenantId = `proj-erasure-${id}`;
  const organizationId = `org-erasure-${id}`;
  const email = `leaver-${id}@acme.test`;
  const colleague = `colleague-${id}@acme.test`;

  const repositories = MemoryGovernanceRepositories.create();
  await repositories.tenantHistory.append({
    organizationId,
    tenantId,
    at: ERASED_AT.subtract({ hours: 1 }),
  });
  await repositories.discoveredPeople.recordDirectorySighting({
    organizationId,
    provider: "anthropic_admin",
    rawActorId: email,
    displayText: "Leaver Person",
    department: "",
    seenAt: ERASED_AT.subtract({ hours: 48 }),
  });
  const [person] = await repositories.discoveredPeople.findByOrganization({ organizationId });
  if (!person) throw new Error("the seeded person is missing");

  const snapshot = SuppressionSnapshotService.create({
    load: async () => {
      const suppressed = await repositories.erasedIdentifierSuppressions.findAllByOrganization({
        organizationId,
      });
      return {
        digestsByOrganization: new Map([
          [organizationId, new Set(suppressed.map((row) => row.identifierHash))],
        ]),
        organizationByTenant: new Map([[tenantId, organizationId]]),
      };
    },
  });
  const suppression = ErasureSuppressionService.create({
    suppressions: repositories.erasedIdentifierSuppressions,
    snapshot: repositories.suppressionSnapshot,
    erasureSecret: SECRET,
  });
  const actorIds = {
    actorIdForRollupWrite: (input: { tenantId: string; rawActorId: string }) =>
      suppression.actorIdForRollupWrite({ ...input, snapshot }),
  };
  const cells = GovernanceCostRollupFoldProjection.create({
    store: GovernanceCostRollupStore.create(rollup),
    actorIds,
  });
  const chargeProjection = GovernanceCostChargeMapProjection.create({ store: charges, cells });

  const recorded: PulledUsageObservedEvent[] = [];
  const spend = ({
    key,
    rawActorId,
    occurredAtMs,
    costNanoMinor,
  }: {
    key: string;
    rawActorId: string;
    occurredAtMs: number;
    costNanoMinor: number;
  }) => {
    const event = pulledUsageObservedEventSchema.parse({
      ...observed({ restatementKey: `${key}-${id}`, rawActorId, occurredAtMs, costNanoMinor }),
      tenantId,
    });
    recorded.push(event);
    return event;
  };

  /** The cycle the fold executor runs for one event, then the charge record beside it. */
  const fold = async (event: PulledUsageObservedEvent) => {
    const store = GovernanceCostRollupStore.create(rollup);
    const context = {
      aggregateId: event.aggregateId,
      tenantId: createTenantId(tenantId),
      key: cells.key(event),
    };
    const read = await store.getWithApplied(event.aggregateId, context);
    const state = cells.apply(read.state ?? cells.init(), event);
    await store.store(state, { ...context, appliedEventIds: [...read.appliedEventIds, event.id] });
    await charges.append(chargeProjection.mapPulledUsageObserved(event), context);
  };

  const replaySince = async ({ tenantIds, since }: { tenantIds: string[]; since: string }) => {
    for (const event of recorded) {
      const day = new Date(event.data.occurredAtMs).toISOString().slice(0, 10);
      if (tenantIds.includes(tenantId) && day >= since) await fold(event);
    }
  };

  const service = IdentityErasureService.create({
    ...repositories,
    suppressions: repositories.erasedIdentifierSuppressions,
    matchSuggestions: repositories.identityMatchSuggestions,
    rollupErasure,
    replay: { replaySince },
    suppressionSnapshot: snapshot,
    replayHorizon: () => null,
    erasureSecret: SECRET,
    now: () => ERASED_AT,
  });

  await fold(
    spend({ key: "d1", rawActorId: email, occurredAtMs: FIRST_DAY_MS, costNanoMinor: 3_000 }),
  );
  await fold(
    spend({ key: "d2", rawActorId: email, occurredAtMs: SECOND_DAY_MS, costNanoMinor: 2_000 }),
  );
  await fold(
    spend({ key: "c1", rawActorId: colleague, occurredAtMs: FIRST_DAY_MS, costNanoMinor: 700 }),
  );

  return {
    tenantId,
    organizationId,
    email,
    colleague,
    standIn: erasureDigest({ secret: SECRET, identifier: email }),
    erase: () => service.erase({ organizationId, discoveredPersonId: person.id }),
    replay: (since: string) => replaySince({ tenantIds: [tenantId], since }),
  };
}

type World = Awaited<ReturnType<typeof worldWithSpend>>;

/** Every surviving cell of the tenant on both days, as `[actor, amount]` pairs. */
async function cellsOf(world: World): Promise<[string, number | null][]> {
  const days = await Promise.all(
    [FIRST_DAY, SECOND_DAY].map((day) =>
      rollup.findCellsForDay({ tenantId: world.tenantId, day, costSource: "pulled" }),
    ),
  );
  return days
    .flat()
    .map((cell): [string, number | null] => [cell.RawActorId, cell.AmountNanoUsd])
    .toSorted(([a], [b]) => a.localeCompare(b));
}

const total = (cells: [string, number | null][], actor: string): number =>
  cells.filter(([id]) => id === actor).reduce((sum, [, amount]) => sum + (amount ?? 0), 0);

/** How many stored versions, in either table, still hold the identifier. */
async function rowsHolding({ tenantId, identifier }: { tenantId: string; identifier: string }) {
  const counts: Record<string, number> = {};
  for (const table of ["governance_cost_rollup_1d", "governance_cost_rollup_charges"]) {
    const result = await clickhouse.query({
      query: `SELECT count() AS held FROM ${table}
              WHERE TenantId = {tenantId:String} AND RawActorId = {identifier:String}`,
      query_params: { tenantId, identifier },
      format: "JSONEachRow",
    });
    counts[table] = Number((await result.json<{ held: string }>())[0]?.held);
  }
  return counts;
}

describe.skipIf(
  !(
    process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
    process.env.TEST_CLICKHOUSE_URL ??
    process.env.CI_CLICKHOUSE_URL
  ),
)("erasing a person's money rows over a real ClickHouse", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-erasure-money",
      names: ["money"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the erasure suite");
    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: {
              buildTime: false,
              skipped: false,
              sharedUrl: endpoint.url,
              privateEndpoints: [],
              settings: {
                coldStorageEnabled: false,
                hotDayOverrides: {},
                childEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
              },
            },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });
    clickhouse = createClient({ url: endpoint.url });
    rollup = ClickHouseGovernanceCostRollupRepository.create(async () => clickhouse);
    charges = ClickHouseGovernanceCostChargeRepository.create(async () => clickhouse);
    rollupErasure = ClickHouseRollupErasureRepository.create(queryClient(clickhouse));
  }, 600_000);

  afterAll(async () => {
    await clickhouse?.close();
  });

  describe("given daily totals holding an erased person's identifier", () => {
    describe("when an edit is attempted on the identifier itself", () => {
      /** @scenario The daily totals cannot be edited to remove a name */
      it("is refused by the storage, which leaves the identifier where it was", async () => {
        const world = await worldWithSpend();

        const edit = clickhouse.command({
          query: `ALTER TABLE governance_cost_rollup_1d
                  UPDATE RawActorId = {standIn:String}
                  WHERE TenantId = {tenantId:String} AND RawActorId = {email:String}`,
          query_params: { standIn: world.standIn, tenantId: world.tenantId, email: world.email },
          clickhouse_settings: { mutations_sync: "1" },
        });

        await expect(edit).rejects.toMatchObject({ code: "420" });
        const held = await rowsHolding({ tenantId: world.tenantId, identifier: world.email });
        expect(held.governance_cost_rollup_1d).toBeGreaterThan(0);
      });
    });
  });

  describe("given daily totals holding an erased person's spend", () => {
    describe("when they are erased and the affected days are rebuilt", () => {
      /** @scenario An erased person's spend comes back under the stand-in, with the same total */
      it("holds no row under the identifier and the same total under the stand-in", async () => {
        const world = await worldWithSpend();
        const before = await cellsOf(world);
        expect(total(before, world.email)).toBeGreaterThan(0);

        const outcome = await world.erase();

        expect(outcome.pseudonym).toBe(world.standIn);
        expect(outcome.affectedDays.map(({ day }) => day)).toEqual([FIRST_DAY, SECOND_DAY]);
        const held = await rowsHolding({ tenantId: world.tenantId, identifier: world.email });
        expect(held.governance_cost_rollup_1d).toBe(0);
        const after = await cellsOf(world);
        expect(after.map(([actor]) => actor)).not.toContain(world.email);
        expect(total(after, world.standIn)).toBe(total(before, world.email));
        expect(total(after, world.colleague)).toBe(total(before, world.colleague));
      });
    });
  });

  describe("given an erased person whose days have been rebuilt once", () => {
    describe("when the same days are rebuilt again", () => {
      /** @scenario Rebuilding twice lands on the same stand-in */
      it("keys the rows by the identical stand-in", async () => {
        const world = await worldWithSpend();
        await world.erase();
        const firstRebuild = await cellsOf(world);
        expect(total(firstRebuild, world.standIn)).toBeGreaterThan(0);

        await rollupErasure.deleteRowsCarryingActor({
          tenantIds: [world.tenantId],
          rawActorId: world.standIn,
        });
        expect(total(await cellsOf(world), world.standIn)).toBe(0);
        await world.replay(FIRST_DAY);

        expect(await cellsOf(world)).toEqual(firstRebuild);
        const held = await rowsHolding({ tenantId: world.tenantId, identifier: world.email });
        expect(held.governance_cost_rollup_1d).toBe(0);
      });
    });
  });

  describe("given an erased person with pulled spend", () => {
    describe("when they are erased", () => {
      /** @scenario Erasure reaches the note of where each pulled charge was filed */
      it("files each charge under the stand-in, on the day and source it was first filed under", async () => {
        const world = await worldWithSpend();
        const filed = async (day: string) => {
          const result = await clickhouse.query({
            query: `SELECT EventId, toString(Day) AS FiledOn, CostSource, IngestionSourceId, RawActorId
                    FROM governance_cost_rollup_charges FINAL
                    WHERE TenantId = {tenantId:String} AND Day = {day:Date}
                      AND RawActorId != {colleague:String}
                    ORDER BY EventId`,
            query_params: { tenantId: world.tenantId, day, colleague: world.colleague },
            format: "JSONEachRow",
          });
          return result.json<{
            EventId: string;
            FiledOn: string;
            CostSource: string;
            IngestionSourceId: string;
            RawActorId: string;
          }>();
        };
        const firstFiled = await filed(FIRST_DAY);
        expect(firstFiled.map((charge) => charge.RawActorId)).toEqual([world.email]);

        await world.erase();

        const refiled = await filed(FIRST_DAY);
        expect(refiled.map((charge) => charge.RawActorId)).toEqual([world.standIn]);
        expect(refiled).toEqual(
          firstFiled.map((charge) => ({ ...charge, RawActorId: world.standIn })),
        );
        const held = await rowsHolding({ tenantId: world.tenantId, identifier: world.email });
        expect(held.governance_cost_rollup_charges).toBe(0);
      });
    });
  });

  describe("given a day's pulled charges", () => {
    describe("when the drift check reads them back", () => {
      it("answers that day's charges from the real server, the day as filed", async () => {
        const world = await worldWithSpend();

        const read = await charges.findChargesForDay({
          tenantId: world.tenantId,
          day: FIRST_DAY,
          costSource: "pulled",
        });

        expect(read.length).toBeGreaterThan(0);
        expect(new Set(read.map((charge) => charge.Day))).toEqual(new Set([FIRST_DAY]));
      });
    });
  });
});
