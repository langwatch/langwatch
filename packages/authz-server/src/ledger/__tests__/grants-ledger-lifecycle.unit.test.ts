import { describe, expect, it } from "vitest";
import {
  CUTOVER_COMPLETION_REFUSALS,
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
        expect(state.cutover.completionRefusedReason).toBeNull();
      });
    });

    describe("when a completion arrives with no proof behind it", () => {
      it("leaves the organization on legacy and records why", () => {
        // The flip is earned by a proof, and this is where that is
        // enforced: any writer - a retried migration, an ops action, a
        // replayed script - reaches the engine only through this fold.
        const state = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
        ]);

        expect(state.cutover.onEngine).toBe(false);
        expect(state.cutover.completionRefusedReason).toBe(
          CUTOVER_COMPLETION_REFUSALS.UNPROVEN,
        );
        // A refusal changed nothing the monotonic guard protects, so it
        // does not arm the guard - see the next case for why.
        expect(state.cutover.changedAtMs).toBeNull();
      });
    });

    describe("when a proof's business time trails a refused completion", () => {
      it("folds the proof instead of dropping it as stale", () => {
        // The refused completion was stamped by a clock running ahead of the
        // prover's. Were the refusal to advance `changedAtMs`, this proof
        // would read as stale, no completion could ever be earned, and the
        // organization would be parked forever.
        const state = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 300_006 },
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 6 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 300_007 },
        ]);

        expect(state.cutover.provedAtMs).toBe(6);
        expect(state.cutover.onEngine).toBe(true);
        expect(state.cutover.completionRefusedReason).toBeNull();
      });
    });

    describe("when a completion arrives on a proof that found disagreements", () => {
      it("leaves the organization on legacy and names the outstanding diffs", () => {
        const state = apply([
          {
            kind: "migration_parity_proved",
            diffs: ["user:u1 traces:view organization:org_acme legacy=true engine=false"],
            occurredAtMs: 5,
          },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
        ]);

        expect(state.cutover.onEngine).toBe(false);
        expect(state.cutover.completionRefusedReason).toBe(
          CUTOVER_COMPLETION_REFUSALS.DIFFS,
        );
      });
    });

    describe("when a refused organization proves clean and completes again", () => {
      it("flips, and stops saying it was refused", () => {
        const state = apply([
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 7 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 8 },
        ]);

        expect(state.cutover.onEngine).toBe(true);
        expect(state.cutover.completionRefusedReason).toBeNull();
      });
    });

    describe("when the cutover is rolled back", () => {
      it("puts the organization back on the legacy path", () => {
        const state = apply([
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 5 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 7 },
        ]);
        expect(state.cutover.onEngine).toBe(false);
      });
    });

    describe("when the rollback's clock ran behind the completion's", () => {
      /**
       * The cross-pod skew timeline. The completion's business time comes
       * from a WORKER's clock; the operator's rollback is decided on a WEB
       * pod whose clock may trail it. The monotonic guard is strict-older-
       * loses, so the writer's contract (runtime.ts, `rollBackAuthzCutover`)
       * is to stamp the fact `max(decidedAt, completion changedAt + 1)` -
       * never behind, never tying. Both halves are pinned here: a tie still
       * applies (the guard drops only STRICTLY older facts, so replay
       * converges), and the +1 keeps the rollback the newest cutover fact so
       * nothing later mistakes the completion for current.
       */
      /** @scenario "A rollback fact lands however the pods' clocks disagree" */
      it("applies a rollback stamped just past the completion, skew or not", () => {
        const state = apply([
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 5 },
          // The worker's clock, five minutes ahead of the web pod that will
          // decide the rollback.
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 300_006 },
          // decidedAt was 6 on the web pod; the writer stamps 300_007.
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 300_007 },
        ]);

        expect(state.cutover.onEngine).toBe(false);
        expect(state.cutover.changedAtMs).toBe(300_007);
      });

      it("still applies a rollback that TIES the completion - only strictly older facts drop", () => {
        const state = apply([
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 5 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 6 },
        ]);

        expect(state.cutover.onEngine).toBe(false);
      });
    });

    describe("when a rolled-back organization completes again", () => {
      /** The re-cutover path: an operator rolls back, the cause is fixed, and
       *  the organization cuts over a second time. The proof it already has
       *  is still standing, so the second completion is not asking for
       *  anything the first did not earn. */
      it("puts it back on the engine", () => {
        const state = apply([
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 5 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 6 },
          { kind: "cutover_rolled_back", actor: ACTOR, occurredAtMs: 7 },
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 8 },
        ]);

        expect(state.cutover.onEngine).toBe(true);
        expect(state.cutover.changedAtMs).toBe(8);
      });
    });

    describe("when a cutover fact arrives after a newer one", () => {
      it("ignores it rather than taking the organization back off the engine", () => {
        // Unlike the grant heads - absolute writes keyed by a deterministic
        // id, where order cannot matter - the cutover fields are
        // last-write-wins over one row. Without the guard this rollback
        // wins on arrival order alone.
        const state = apply([
          { kind: "migration_parity_proved", diffs: [], occurredAtMs: 19 },
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
        const proved: GrantsLedgerEvent = {
          kind: "migration_parity_proved",
          diffs: [],
          occurredAtMs: 19,
        };
        const once = apply([
          proved,
          { kind: "cutover_completed", actor: ACTOR, occurredAtMs: 20 },
        ]);
        const twice = apply([
          proved,
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

    describe("when a witness arrives after a newer one", () => {
      /** @scenario "A backdated witness cannot rewrite a migration's status backwards" */
      it("ignores it rather than rewriting the witnessed status backwards", () => {
        // Same last-write-wins shape as the cutover fields: without the
        // guard, a redelivered or reordered witness at an older timestamp
        // would win on arrival order alone and rewrite "finalized" back to
        // "parked".
        const state = apply([
          {
            kind: "migration_tenant_state_changed",
            migrationName: "authz-team-user-backfill",
            status: "finalized",
            actor: ACTOR,
            occurredAtMs: 20,
          },
          {
            kind: "migration_tenant_state_changed",
            migrationName: "authz-team-user-backfill",
            status: "parked",
            report: { kind: "error", message: "stale redelivery" },
            actor: ACTOR,
            occurredAtMs: 10,
          },
        ]);
        expect(state.migrationStates["authz-team-user-backfill"]).toEqual({
          status: "finalized",
          occurredAtMs: 20,
        });
      });

      it("keeps each migration's guard independent of the others", () => {
        const state = apply([
          {
            kind: "migration_tenant_state_changed",
            migrationName: "authz-team-user-backfill",
            status: "finalized",
            actor: ACTOR,
            occurredAtMs: 20,
          },
          {
            kind: "migration_tenant_state_changed",
            migrationName: "authz-grants-genesis-import",
            status: "parked",
            actor: ACTOR,
            occurredAtMs: 1,
          },
        ]);
        expect(state.migrationStates["authz-team-user-backfill"]?.status).toBe(
          "finalized",
        );
        expect(
          state.migrationStates["authz-grants-genesis-import"]?.status,
        ).toBe("parked");
      });
    });

    describe("when the same witness is folded twice", () => {
      it("converges rather than dropping the fact that produced the state", () => {
        const event = {
          kind: "migration_tenant_state_changed" as const,
          migrationName: "authz-team-user-backfill",
          status: "finalized" as const,
          actor: ACTOR,
          occurredAtMs: 20,
        };
        const once = apply([event]);
        const twice = apply([event, event]);
        expect(twice.migrationStates).toEqual(once.migrationStates);
      });
    });
  });
});
