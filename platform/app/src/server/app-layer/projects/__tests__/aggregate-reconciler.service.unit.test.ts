/**
 * ADR-144 block E: the reconciler diffs what an aggregate's rule wants with
 * the live shared reads the ledger holds and writes only the difference. An
 * in-memory ledger stands in for the grants ledger; the integration suite
 * proves the same against Postgres and the real pipeline.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { describe, expect, it } from "vitest";
import {
  AGGREGATE_RECONCILE_SWEEP,
  AGGREGATE_RULE_NO_LONGER_MATCHES,
  AggregateReconciler,
  type AggregateSweepSchedule,
  aggregateReconcileSweepHandler,
  type SharedProjectGrantsLedger,
} from "../aggregate-reconciler.service";
import type { AggregateRule } from "../aggregate-rule";
import type {
  AggregateProjectRepository,
  AggregateReconcileLock,
  StoredAggregateProject,
} from "../repositories/aggregate-rule.repository";

const ORG = "org_acme";
const NOW = new Date("2026-10-07T10:00:00.000Z");

/** One caller at a time is all these tests make; the lock has its own suite. */
const NO_CONTENTION: AggregateReconcileLock = {
  withAggregateLock: (_params, reconcile) => reconcile(),
};

type LiveRow = {
  grantId: string;
  readerProjectId: string;
  memberProjectId: string;
  condition: unknown;
  actor?: unknown;
  source?: string;
  revokedReason?: string;
};

/** The ledger as the reconciler sees it: rows, attached and revoked. */
function inMemoryLedger(
  seed: Array<{ readerProjectId: string; memberProjectId: string }> = [],
) {
  const rows: LiveRow[] = seed.map((row, index) => ({
    ...row,
    grantId: `grant_seed_${index}`,
    condition: { type: "trace", from: "2026-01-01T00:00:00.000Z" },
  }));
  const revoked: LiveRow[] = [];
  let minted = 0;
  const ledger: SharedProjectGrantsLedger = {
    async findLiveSharedProjectGrants({ readerProjectId }) {
      return rows
        .filter((row) => row.readerProjectId === readerProjectId)
        .map(({ grantId, memberProjectId }) => ({ grantId, memberProjectId }));
    },
    async attachSharedProjectGrant({
      readerProjectId,
      memberProjectId,
      condition,
      actor,
      source,
    }) {
      const existing = rows.find(
        (row) =>
          row.readerProjectId === readerProjectId &&
          row.memberProjectId === memberProjectId,
      );
      if (existing) return { grantId: existing.grantId, attached: false };
      const grantId = `grant_${++minted}`;
      rows.push({
        grantId,
        readerProjectId,
        memberProjectId,
        condition,
        actor,
        source,
      });
      return { grantId, attached: true };
    },
    async revokeSharedProjectGrants({
      readerProjectId,
      memberProjectIds,
      reason,
    }) {
      const out = rows.filter(
        (row) =>
          row.readerProjectId === readerProjectId &&
          (memberProjectIds ?? []).includes(row.memberProjectId),
      );
      for (const row of out) {
        rows.splice(rows.indexOf(row), 1);
        revoked.push({ ...row, revokedReason: reason });
      }
      return out.map((row) => row.grantId);
    },
  };
  return { ledger, rows, revoked };
}

function aggregatesOf(
  stored: StoredAggregateProject[],
): AggregateProjectRepository {
  return {
    async findAggregate({ aggregateProjectId }) {
      return stored.find((row) => row.id === aggregateProjectId) ?? null;
    },
    async findLiveAggregateIds({ organizationId }) {
      return stored
        .filter((row) => row.organizationId === organizationId && !row.archived)
        .map((row) => row.id);
    },
  };
}

/** Membership by rule kind, fixed: the rule service has its own tests. */
function rulesResolvingTo(members: Record<string, string[]>) {
  return {
    async membersOf({ rule }: { rule: AggregateRule }) {
      return [...(members[rule.kind] ?? [])].sort();
    },
  };
}

function aggregate(
  overrides: Partial<StoredAggregateProject> = {},
): StoredAggregateProject {
  return {
    id: "agg_1",
    organizationId: ORG,
    archived: false,
    rule: { kind: "all-personal" },
    ...overrides,
  };
}

function reconcilerFor({
  stored = [aggregate()],
  members = { "all-personal": ["p_a", "p_b"] },
  ledger,
  schedule,
}: {
  stored?: StoredAggregateProject[];
  members?: Record<string, string[]>;
  ledger: SharedProjectGrantsLedger;
  schedule?: AggregateSweepSchedule;
}) {
  return new AggregateReconciler({
    aggregates: aggregatesOf(stored),
    lock: NO_CONTENTION,
    rules: rulesResolvingTo(members),
    ledger: () => ledger,
    schedule,
    now: () => NOW,
  });
}

describe("AggregateReconciler", () => {
  describe("given an aggregate whose rule wants two members and holds none", () => {
    describe("when it is reconciled", () => {
      it("attaches one trace read per member from now on, with no end", async () => {
        const { ledger, rows } = inMemoryLedger();

        const result = await reconcilerFor({ ledger }).reconcile({
          aggregateProjectId: "agg_1",
        });

        expect(result).toEqual({
          attached: ["p_a", "p_b"],
          revoked: [],
          unchanged: [],
        });
        expect(rows.map((row) => row.condition)).toEqual([
          { type: "trace", from: NOW.toISOString() },
          { type: "trace", from: NOW.toISOString() },
        ]);
        for (const row of rows) {
          expect(row.actor).toEqual({
            type: "system",
            id: SYSTEM_ACTORS.aggregateReconciler,
          });
          expect(row.source).toBe("aggregate-reconciler");
        }
      });
    });
  });

  describe("given an aggregate holding a member the rule no longer wants", () => {
    describe("when it is reconciled", () => {
      it("revokes that member with the rule-no-longer-matches reason and keeps the rest", async () => {
        const { ledger, revoked } = inMemoryLedger([
          { readerProjectId: "agg_1", memberProjectId: "p_a" },
          { readerProjectId: "agg_1", memberProjectId: "p_gone" },
        ]);

        const result = await reconcilerFor({
          ledger,
          members: { "all-personal": ["p_a"] },
        }).reconcile({ aggregateProjectId: "agg_1" });

        expect(result).toEqual({
          attached: [],
          revoked: ["p_gone"],
          unchanged: ["p_a"],
        });
        expect(revoked).toEqual([
          expect.objectContaining({
            memberProjectId: "p_gone",
            revokedReason: AGGREGATE_RULE_NO_LONGER_MATCHES,
          }),
        ]);
      });
    });
  });

  describe("given a member to revoke and one to attach whose attach fails", () => {
    describe("when it is reconciled", () => {
      it("has already revoked the member that stopped matching", async () => {
        const { ledger, revoked } = inMemoryLedger([
          { readerProjectId: "agg_1", memberProjectId: "p_gone" },
        ]);
        const failingAttach: SharedProjectGrantsLedger = {
          ...ledger,
          async attachSharedProjectGrant() {
            throw new Error("ledger unavailable");
          },
        };

        await expect(
          reconcilerFor({
            ledger: failingAttach,
            members: { "all-personal": ["p_new"] },
          }).reconcile({ aggregateProjectId: "agg_1" }),
        ).rejects.toThrow("ledger unavailable");
        expect(revoked.map((row) => row.memberProjectId)).toEqual(["p_gone"]);
      });
    });
  });

  describe("given an aggregate whose members are current", () => {
    describe("when it is reconciled again", () => {
      it("attaches nothing, revokes nothing, and leaves the rows as they were", async () => {
        const { ledger, rows } = inMemoryLedger();
        const reconciler = reconcilerFor({ ledger });
        await reconciler.reconcile({ aggregateProjectId: "agg_1" });
        const before = structuredClone(rows);

        const again = await reconciler.reconcile({
          aggregateProjectId: "agg_1",
        });

        expect(again).toEqual({
          attached: [],
          revoked: [],
          unchanged: ["p_a", "p_b"],
        });
        expect(rows).toEqual(before);
      });
    });
  });

  describe("given an aggregate whose stored rule does not parse", () => {
    describe("when it is reconciled", () => {
      it("reconciles nothing, not even revoking what it holds", async () => {
        const { ledger, rows, revoked } = inMemoryLedger([
          { readerProjectId: "agg_1", memberProjectId: "p_a" },
        ]);

        const result = await reconcilerFor({
          ledger,
          stored: [aggregate({ rule: null })],
        }).reconcile({ aggregateProjectId: "agg_1" });

        expect(result).toEqual({ attached: [], revoked: [], unchanged: [] });
        expect(rows).toHaveLength(1);
        expect(revoked).toHaveLength(0);
      });
    });
  });

  describe("given an archived aggregate", () => {
    describe("when it is reconciled", () => {
      it("reconciles nothing", async () => {
        const { ledger, rows } = inMemoryLedger();

        const result = await reconcilerFor({
          ledger,
          stored: [aggregate({ archived: true })],
        }).reconcile({ aggregateProjectId: "agg_1" });

        expect(result).toEqual({ attached: [], revoked: [], unchanged: [] });
        expect(rows).toHaveLength(0);
      });
    });
  });

  describe("given an id that is not an aggregate", () => {
    describe("when it is reconciled", () => {
      it("reconciles nothing", async () => {
        const { ledger, rows } = inMemoryLedger();

        const result = await reconcilerFor({ ledger }).reconcile({
          aggregateProjectId: "p_ordinary",
        });

        expect(result).toEqual({ attached: [], revoked: [], unchanged: [] });
        expect(rows).toHaveLength(0);
      });
    });
  });

  describe("given an organisation with two aggregates, one of which fails", () => {
    describe("when the organisation is reconciled", () => {
      it("lists the failure and still reconciles the other", async () => {
        const { ledger, rows } = inMemoryLedger();
        const failing: SharedProjectGrantsLedger = {
          ...ledger,
          async findLiveSharedProjectGrants(params) {
            if (params.readerProjectId === "agg_broken") {
              throw new Error("ledger unavailable");
            }
            return ledger.findLiveSharedProjectGrants(params);
          },
        };

        const outcome = await reconcilerFor({
          ledger: failing,
          stored: [
            aggregate({ id: "agg_broken" }),
            aggregate({ id: "agg_ok" }),
          ],
        }).reconcileOrganization({ organizationId: ORG });

        expect(
          outcome.failed.map((failure) => failure.aggregateProjectId),
        ).toEqual(["agg_broken"]);
        expect(outcome.reconciled).toEqual([
          {
            aggregateProjectId: "agg_ok",
            result: { attached: ["p_a", "p_b"], revoked: [], unchanged: [] },
          },
        ]);
        expect(rows.every((row) => row.readerProjectId === "agg_ok")).toBe(
          true,
        );
      });
    });

    describe("when a trigger reconciles it and the listing itself fails", () => {
      it("logs and does not throw", async () => {
        const { ledger } = inMemoryLedger();
        const reconciler = new AggregateReconciler({
          aggregates: {
            findAggregate: async () => null,
            findLiveAggregateIds: async () => {
              throw new Error("database unavailable");
            },
          },
          lock: NO_CONTENTION,
          rules: rulesResolvingTo({}),
          ledger: () => ledger,
        });

        await expect(
          reconciler.reconcileOrganizationOrLog({
            organizationId: ORG,
            trigger: "department-assigned",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given a new aggregate", () => {
    describe("when it is started", () => {
      it("schedules its nightly sweep and attaches its members", async () => {
        const { ledger, rows } = inMemoryLedger();
        const upserts: unknown[] = [];
        const schedule: AggregateSweepSchedule = {
          async upsertForTarget(params) {
            upserts.push(params);
          },
          async deactivateForTarget() {},
        };

        await reconcilerFor({ ledger, schedule }).start({
          aggregateProjectId: "agg_1",
        });

        expect(upserts).toEqual([
          {
            projectId: "agg_1",
            targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
            targetId: "agg_1",
            cron: AGGREGATE_RECONCILE_SWEEP.cron,
            timezone: AGGREGATE_RECONCILE_SWEEP.timezone,
            nextRunAt: new Date("2026-10-08T03:17:00.000Z"),
          },
        ]);
        expect(rows.map((row) => row.memberProjectId)).toEqual(["p_a", "p_b"]);
      });

      it("does not throw when the reconcile fails", async () => {
        const { ledger } = inMemoryLedger();
        const broken: SharedProjectGrantsLedger = {
          ...ledger,
          async findLiveSharedProjectGrants() {
            throw new Error("ledger unavailable");
          },
        };

        await expect(
          reconcilerFor({ ledger: broken }).start({
            aggregateProjectId: "agg_1",
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given the sweep's scheduled job comes due", () => {
    describe("when its handler fires", () => {
      it("reconciles the aggregate the job targets", async () => {
        const { ledger, rows } = inMemoryLedger();
        const handler = aggregateReconcileSweepHandler(
          reconcilerFor({ ledger }),
        );

        await handler({
          projectId: "agg_1",
          targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
          targetId: "agg_1",
          slot: NOW,
        });

        expect(rows.map((row) => row.memberProjectId)).toEqual(["p_a", "p_b"]);
      });
    });
  });
});
