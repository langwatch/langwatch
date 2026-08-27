/** @vitest-environment node */

/**
 * The one write either reconciliation surface has (ADR-122): a platform
 * operator sending a retired apply through again.
 *
 * Exercised against the real service over in-memory stand-ins for the
 * projection read and the two things it drives — the sync history and the
 * deprovision that actually re-runs the removal. The doubles are stand-ins
 * for STORAGE, never for the rule under test: the guard's silence, the
 * refusal, the ordering (recorded before it runs) and the idempotency are all
 * the service's own and all asserted directly.
 *
 * This is bound at unit level rather than against Postgres because this
 * machine has no `LANGWATCH_TEST_DATABASE_URL`; what a real database would
 * add is that the projection read answers the same way, which is one `where`
 * and is asserted in the repository's own shape.
 *
 * @see specs/identity/scim-reconciliation-surfaces.feature
 */
import type { ScimSyncFailure, ScimSyncState } from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimOversightService } from "../scim-oversight.service";

const ORG = "org_acme";
const CONNECTION = "acme-okta";
const RETIRED_AT = 1_756_000_002_000;

function failure(overrides: Partial<ScimSyncFailure> = {}): ScimSyncFailure {
  return {
    op: "deactivate_user",
    errorCode: "offboard_incomplete",
    attempts: 5,
    retiredAtMs: RETIRED_AT,
    redrivenAtMs: null,
    userId: "user_sam",
    occurredAtMs: RETIRED_AT,
    ...overrides,
  };
}

function sync(overrides: Partial<ScimSyncState> = {}): ScimSyncState {
  return {
    scimSyncId: CONNECTION,
    connectionId: CONNECTION,
    organizationId: ORG,
    state: "ERROR",
    lastPushedAtMs: 1_756_000_001_000,
    lastFailure: failure(),
    deadLetters: [failure()],
    revokedCause: null,
    createdAtMs: 1_756_000_000_000,
    updatedAtMs: RETIRED_AT,
    ...overrides,
  };
}

/**
 * The projection read, in memory — and it answers from a mutable cell so a
 * second re-drive sees what the first one wrote, which is the only way
 * "twice applies once" can be observed rather than assumed.
 */
function createReads(initial: ScimSyncState | null) {
  let held = initial;
  return {
    held: () => held,
    set: (next: ScimSyncState | null) => {
      held = next;
    },
    port: {
      findAllSyncs: vi.fn(async () => ({
        syncs: held ? [held] : [],
        total: held ? 1 : 0,
      })),
      findSyncById: vi.fn(async () => held),
      findDirectoryIdentities: vi.fn(async () => []),
      findOrganizationNames: vi.fn(async () => new Map([[ORG, "Acme"]])),
    },
  };
}

let reads: ReturnType<typeof createReads>;
let lifecycle: { applyRedriven: ReturnType<typeof vi.fn> };
let deprovision: { removeAccess: ReturnType<typeof vi.fn> };
let service: ScimOversightService;
/** Everything that happened, in order — the ordering IS a promise here. */
let order: string[];

function build(initial: ScimSyncState | null): void {
  order = [];
  reads = createReads(initial);
  lifecycle = {
    applyRedriven: vi.fn(async () => {
      order.push("recorded");
      // The fact the guard would have stated, folded into the read the next
      // call makes: the dead letter is stamped and is no longer re-drivable.
      const held = reads.held();
      if (!held) return;
      reads.set({
        ...held,
        deadLetters: held.deadLetters.map((letter) =>
          letter.retiredAtMs === RETIRED_AT
            ? { ...letter, redrivenAtMs: RETIRED_AT + 1_000 }
            : letter,
        ),
      });
    }),
  };
  deprovision = {
    removeAccess: vi.fn(async () => {
      order.push("applied");
    }),
  };
  service = new ScimOversightService({
    reads: reads.port as never,
    lifecycle: () => lifecycle as never,
    // `vi.fn()` types its arguments loosely, so the double satisfies the
    // port's shape without restating the command it takes — the scenario
    // below asserts on the exact argument anyway.
    deprovision: () => deprovision as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  build(sync());
});

describe("the operator's directory sync oversight", () => {
  describe("given an apply retired as unretryable whose cause has been fixed", () => {
    /** @scenario "Re-driving a retired apply is a recorded act" */
    it("runs the apply again and records the act with the operator on it", async () => {
      const outcome = await service.redriveRetiredApply({
        connectionId: CONNECTION,
        retiredAtMs: RETIRED_AT,
        operator: { userId: "user_ops" },
      });

      expect(outcome).toEqual({ applied: true });

      // The removal ran again, against the person the dead letter named and
      // through the same deprovision the directory's own removal uses — so
      // the re-driven removal carries the same proof.
      expect(deprovision.removeAccess).toHaveBeenCalledWith({
        userId: "user_sam",
        organizationId: ORG,
        connectionId: CONNECTION,
        op: "deactivate_user",
      });

      // Recorded with the operator on the fact, in the tenant's own history.
      expect(lifecycle.applyRedriven).toHaveBeenCalledWith({
        organizationId: ORG,
        connectionId: CONNECTION,
        retiredAtMs: RETIRED_AT,
        operator: { userId: "user_ops" },
      });

      // Recorded AFTER it ran, and the two records are different records.
      //
      // The OPERATOR'S ACT is held by `audited()`, which the router writes
      // before the service is called at all — so an attempt that then failed
      // is in history either way, which is what that history is for.
      //
      // This fact is about the LETTER, and it is what `alreadyDriven` reads.
      // Stamping it first meant a removal that threw left a letter reading as
      // driven: the operator pressed again, matched the stamp, and was told
      // "already done" about a deprovision that never happened. Somebody the
      // directory asked to deactivate kept their access, permanently, while
      // the log agreed they had not.
      expect(order).toEqual(["applied", "recorded"]);
    });

    it("leaves the letter re-drivable when the removal fails", async () => {
      deprovision.removeAccess.mockRejectedValueOnce(
        new Error("grants service is down"),
      );

      await expect(
        service.redriveRetiredApply({
          connectionId: CONNECTION,
          retiredAtMs: RETIRED_AT,
          operator: { userId: "user_ops" },
        }),
      ).rejects.toThrow(/grants service is down/);

      // Nothing was stamped, so the next press is a real retry rather than a
      // refusal that reads as success.
      expect(lifecycle.applyRedriven).not.toHaveBeenCalled();
    });

    /** @scenario "Re-driving twice applies once" */
    it("applies the directory's operation exactly once when re-driven twice", async () => {
      await service.redriveRetiredApply({
        connectionId: CONNECTION,
        retiredAtMs: RETIRED_AT,
        operator: { userId: "user_ops" },
      });
      const second = await service.redriveRetiredApply({
        connectionId: CONNECTION,
        retiredAtMs: RETIRED_AT,
        operator: { userId: "user_ops" },
      });

      // The second press is not an error — the operator asked for something
      // to have happened and it has — and it runs nothing.
      expect(second).toEqual({ applied: false });
      expect(deprovision.removeAccess).toHaveBeenCalledTimes(1);
      expect(lifecycle.applyRedriven).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an apply that is still being retried", () => {
    /** @scenario "An apply that is not retired cannot be re-driven" */
    it("refuses it by name and runs nothing", async () => {
      // Failing, but nothing retired: the identity provider will try again on
      // its own schedule.
      build(
        sync({
          lastFailure: failure({ retiredAtMs: null, attempts: 2 }),
          deadLetters: [],
        }),
      );

      const refusal = await service
        .redriveRetiredApply({
          connectionId: CONNECTION,
          retiredAtMs: RETIRED_AT,
          operator: { userId: "user_ops" },
        })
        .catch((error: unknown) => error as { code: string });

      expect(refusal).toMatchObject({ code: "scim_apply_not_retired" });
      expect(deprovision.removeAccess).not.toHaveBeenCalled();
      expect(lifecycle.applyRedriven).not.toHaveBeenCalled();
    });
  });

  describe("given a retired apply the history cannot reconstruct", () => {
    it("refuses an addition by name rather than inventing a push", async () => {
      // The payload rule keeps the directory's own data off the fact, so a
      // failed ADDITION has nothing left to send through again.
      build(
        sync({
          deadLetters: [
            failure({ op: "push_user", errorCode: "validation_error" }),
          ],
        }),
      );

      const refusal = await service
        .redriveRetiredApply({
          connectionId: CONNECTION,
          retiredAtMs: RETIRED_AT,
          operator: { userId: "user_ops" },
        })
        .catch((error: unknown) => error as { code: string });

      expect(refusal).toMatchObject({ code: "scim_apply_not_redrivable" });
      expect(deprovision.removeAccess).not.toHaveBeenCalled();
    });
  });

  describe("given a connection the operator names that has no sync", () => {
    it("refuses rather than answering as though there were nothing to do", async () => {
      build(null);

      const refusal = await service
        .redriveRetiredApply({
          connectionId: CONNECTION,
          retiredAtMs: RETIRED_AT,
          operator: { userId: "user_ops" },
        })
        .catch((error: unknown) => error as { code: string });

      expect(refusal).toMatchObject({ code: "scim_apply_not_retired" });
    });
  });

  describe("when the operator lists every customer's connections", () => {
    /** @scenario "Every customer's connections are one operator list" */
    it("lists them across organizations with their sync states and a total to page by", async () => {
      const listed = await service.getAll({ page: 0, pageSize: 25 });

      expect(listed.total).toBe(1);
      expect(listed.syncs).toEqual([
        expect.objectContaining({
          connectionId: CONNECTION,
          organizationId: ORG,
          // Resolved server-side: an operator scanning a cross-customer table
          // against an identifier has not been told anything they can check.
          organizationName: "Acme",
          state: "ERROR",
        }),
      ]);
      // Searching and paging are the list's, exactly as the other operator
      // lists have them.
      expect(reads.port.findAllSyncs).toHaveBeenCalledWith({
        page: 0,
        pageSize: 25,
        search: undefined,
      });
    });

    /** @scenario "A dead letter opens to the intent behind it" */
    it("opens a failure to the retired intent, its error and its retry history", async () => {
      const opened = await service.getById({ connectionId: CONNECTION });

      expect(opened?.deadLetters).toEqual([
        expect.objectContaining({
          op: "deactivate_user",
          errorCode: "offboard_incomplete",
          attempts: 5,
          retiredAtMs: RETIRED_AT,
          redrivenAtMs: null,
          userId: "user_sam",
        }),
      ]);
    });
  });

  describe("when the operator opens a person the directory manages", () => {
    /** @scenario "The mapping detail is the operator's, not the customer's" */
    it("shows the identifier the directory knows them by, per connection", async () => {
      reads.port.findDirectoryIdentities.mockResolvedValueOnce([
        {
          connectionId: CONNECTION,
          externalId: "u-1",
          userId: "user_sam",
          createdAtMs: 1,
          updatedAtMs: 2,
        },
      ] as never);

      const mapped = await service.getDirectoryIdentities({
        connectionId: CONNECTION,
      });

      expect(mapped).toEqual([
        expect.objectContaining({
          connectionId: CONNECTION,
          externalId: "u-1",
          userId: "user_sam",
        }),
      ]);
      // Keyed on the connection, never on the identifier alone: the same
      // directory identifier on two connections is two different people.
      expect(reads.port.findDirectoryIdentities).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: CONNECTION }),
      );
    });
  });
});
