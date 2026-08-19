import { describe, expect, it } from "vitest";
import {
  emptyGrantsLedgerState,
  reduceGrantsLedger,
  type GrantsLedgerEvent,
  type GrantsLedgerState,
} from "../grants-ledger.reducer";

/**
 * The migration-lifecycle half of the reducer: the cutover fields and the
 * runner's witnessed transitions. Split from `grants-ledger.unit.test.ts`,
 * which covers the grant and role heads.
 *
 * These two halves behave differently on purpose, which is why they read
 * better apart. Grant and role applies are absolute writes keyed by a
 * deterministic id, so order cannot matter. The cutover and migration-state
 * fields are last-write-wins over a single row, so order is the whole
 * question and each carries its own monotonic guard.
 */

const ORG = "org_acme";
const ACTOR = { type: "user" as const, id: "user_admin" };

function apply(
  events: GrantsLedgerEvent[],
  from?: GrantsLedgerState,
): GrantsLedgerState {
  return events.reduce(
    (state, event) => reduceGrantsLedger({ state, event }),
    from ?? emptyGrantsLedgerState({ organizationId: ORG }),
  );
}

describe("grants ledger reducer, migration lifecycle", () => {
  describe("given the cutover process events", () => {
    describe("when parity is proved and the cutover completes", () => {
      const state = apply([
        { kind: "migration_parity_proved", diffs: [], occurredAtMs: 5 },
        { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
      ]);

      it("marks the organization as on the engine with its proof", () => {
        expect(state.cutover.onEngine).toBe(true);
        expect(state.cutover.provedAtMs).toBe(5);
        expect(state.cutover.parityDiffs).toEqual([]);
      });
    });

    describe("when the cutover is rolled back", () => {
      it("puts the organization back on the legacy path", () => {
        const state = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 7 },
        ]);
        expect(state.cutover.onEngine).toBe(false);
      });
    });

    describe("when a cutover fact arrives after a newer one", () => {
      it("ignores it rather than taking the organization back off the engine", () => {
        // Unlike the grant heads - absolute writes keyed by a deterministic
        // id, where order cannot matter - the cutover fields are
        // last-write-wins over one row. Without the guard this rollback
        // wins on arrival order alone.
        const state = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 20 },
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 10 },
        ]);
        expect(state.cutover.onEngine).toBe(true);
        expect(state.cutover.changedAtMs).toBe(20);
      });

      it("keeps the newer parity proof and its diffs", () => {
        const state = apply([
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 30 },
          {
            kind: "migration_parity_proved",
            diffs: ["stale"],
            occurredAtMs: 5,
          },
        ]);
        expect(state.cutover.provedAtMs).toBe(30);
        expect(state.cutover.parityDiffs).toEqual([]);
      });
    });

    describe("when the same cutover fact is folded twice", () => {
      it("converges rather than dropping the fact that produced the state", () => {
        const once = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 20 },
        ]);
        const twice = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 20 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 20 },
        ]);
        expect(twice.cutover).toEqual(once.cutover);
      });
    });
  });

  describe("given the runner's lifecycle witnesses", () => {
    describe("when transitions arrive in order", () => {
      it("keeps the latest state per migration, report and all", () => {
        const state = apply([
          {
            kind: "migration_tenant_state_changed",
            migrationName: "authz-team-user-backfill",
            status: "parked",
            report: { kind: "error", message: "boom" },
            actor: ACTOR,
            occurredAtMs: 5,
          },
          {
            kind: "migration_tenant_state_changed",
            migrationName: "authz-team-user-backfill",
            status: "finalized",
            actor: ACTOR,
            occurredAtMs: 6,
          },
        ]);
        expect(state.migrationStates["authz-team-user-backfill"]).toEqual({
          status: "finalized",
          occurredAtMs: 6,
        });
      });
    });
  });
});
