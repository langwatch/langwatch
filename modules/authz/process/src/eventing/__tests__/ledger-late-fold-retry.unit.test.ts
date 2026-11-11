/**
 * A retry after a read-your-writes timeout must be confirmed by the earlier
 * attempt's append once the fold lands it, not wait on its own (tasks#1136).
 * The real adapter runs over the memory repositories; only the fold is slow.
 */
import type { LedgerActor } from "@langwatch/authorization";
import {
  AuthzGrantNotConfirmedError,
  type AttachGrantCommandData,
  type DefineRoleCommandData,
} from "@langwatch/authz-contract";
import { createTenantId } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzGrantProjectionRepository } from "../../repositories/memory/memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "../../repositories/memory/memory.authz-ledger-read.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "../../repositories/memory/memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzRevocationRepository } from "../../repositories/memory/memory.authz-revocation.repository.ts";
import { MemoryAuthzEpochRepository } from "../../repositories/memory/memory.authz.repositories.ts";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../services/authz-grants-command-dispatcher.service.ts";
import { AttachGrantCommand, DefineRoleCommand } from "../authz-grant.commands.ts";
import { AuthzGrantProjection } from "../authz-grant.projection.ts";
import { EventingAuthzLedgerAdapter } from "../authz-grant.store.ts";

const ORG_ID = "org_late_fold";
const ACTOR: LedgerActor = { type: "user", id: "user_admin" };
const T0 = Date.parse("2026-11-01T00:00:00.000Z");

/** Folds seen in production: past the window, and up to the slowest worst case (~48 s). */
const FOLD_LAGS_MS = [25_000, 48_000];
const WINDOW_MS = 10_000;

const ROLE = {
  organizationId: ORG_ID,
  roleId: "role_R",
  name: "R",
  permissions: ["traces:view"],
  kind: "custom" as const,
  actor: ACTOR,
};

const grantFor = (bindingId: string) => ({
  bindingId,
  principal: { userId: "user_sam" },
  role: "MEMBER" as const,
  customRoleId: null,
  scopeType: "TEAM" as const,
  scopeId: "team_support",
});

const attach = (bindingId: string) => ({
  organizationId: ORG_ID,
  bindings: [grantFor(bindingId)],
  actor: ACTOR,
  onDuplicate: "skip" as const,
});

/**
 * Appends are durable at once but the fold applies each one only after `lagMs`:
 * the command's real handler makes the event, the real projection maps it, the
 * memory projection store lands it.
 */
class LaggingFoldDispatcher extends AuthzGrantsCommandDispatcher {
  constructor(
    private readonly store: MemoryAuthzGrantProjectionRepository,
    private readonly lagMs: number,
  ) {
    super();
  }

  private foldLater(event: Parameters<AuthzGrantProjection["map"]>[0]): void {
    const projection = AuthzGrantProjection.create(this.store);
    setTimeout(() => {
      void this.store.append(projection.map(event));
    }, this.lagMs);
  }

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    const unused = { send: async () => Promise.reject(new Error("not used by this test")) };
    return {
      commands: {
        attachGrant: {
          send: async (data: AttachGrantCommandData) => {
            const [event] = new AttachGrantCommand().handle({
              tenantId: createTenantId(data.tenantId),
              data,
            } as never);
            this.foldLater(event!);
          },
        },
        defineRole: {
          send: async (data: DefineRoleCommandData) => {
            const [event] = new DefineRoleCommand().handle({
              tenantId: createTenantId(data.tenantId),
              data,
            } as never);
            this.foldLater(event!);
          },
        },
        changeGrantRole: unused,
        revokeGrant: unused,
        changeRolePermissions: unused,
        deleteRole: unused,
      },
    };
  }
}

function ledger(foldLagMs: number) {
  const memory = AuthzMemoryStore.create();
  memory.memberships.set(memory.membershipKey(ORG_ID, "user_sam"), {
    role: "MEMBER",
    disabled: false,
    membershipStamp: "stamp_user_sam",
    pendingSsoGrantId: null,
    createdAt: Temporal.Instant.fromEpochMilliseconds(T0),
  });
  const projection = MemoryAuthzGrantProjectionRepository.create({ memory });
  const writer = EventingAuthzLedgerAdapter.create({
    reads: MemoryAuthzLedgerReadRepository.create({ memory }),
    dispatcher: new LaggingFoldDispatcher(projection, foldLagMs),
    lineage: { findProjectLineage: async () => null },
    epoch: MemoryAuthzEpochRepository.create({ memory }),
    revocation: MemoryAuthzRevocationRepository.create({ memory }),
    membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
  });
  return { writer, memory };
}

/** Tracks a promise without awaiting it, so the test can ask "settled yet?". */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise
    .then((value) => Object.assign(state, { settled: true, value }))
    .catch((error: unknown) => Object.assign(state, { settled: true, error }));
  return state;
}

const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(FOLD_LAGS_MS)(
  "given a fold that lands each append %i ms after the read-your-writes window",
  (lag) => {
    describe("when a role definition is retried after the first try's event landed", () => {
      it("times out on the first try, then the retry is confirmed at once by the landed role", async () => {
        const { writer, memory } = ledger(lag);

        const first = track(writer.defineRole(ROLE));
        await elapse(WINDOW_MS + 500);
        expect(first.error).toBeInstanceOf(AuthzGrantNotConfirmedError);
        expect(memory.roleHeads).toHaveLength(0);

        await elapse(lag);
        expect(memory.roleHeads.map((row) => row.id)).toEqual([ROLE.roleId]);

        const retry = track(writer.defineRole(ROLE));
        await elapse(0);

        expect(retry.settled).toBe(true);
        expect(retry.error).toBeUndefined();
      });
    });

    describe("when a skipping attach is retried for an identity an earlier attempt appended", () => {
      let writer: ReturnType<typeof ledger>["writer"];
      let memory: ReturnType<typeof ledger>["memory"];

      beforeEach(async () => {
        ({ writer, memory } = ledger(lag));
        const first = track(writer.attachBindings(attach("rb_first")));
        await elapse(WINDOW_MS + 500);
        expect(first.error).toBeInstanceOf(AuthzGrantNotConfirmedError);
      });

      it("returns at once as a duplicate once the earlier append has landed", async () => {
        await elapse(lag);
        expect(memory.grants.map((row) => row.id)).toEqual(["rb_first"]);

        const retry = track(writer.attachBindings(attach("rb_retry")));
        await elapse(0);

        expect(retry.settled).toBe(true);
        expect(retry.value).toEqual({ attached: [], duplicates: ["rb_first"] });
      });

      it("is confirmed by the earlier attempt once that one lands inside the retry's window", async () => {
        // Called 7 s before the first append lands, so that lands inside the retry's own window
        // while the retry's own append lands a full fold later.
        await elapse(lag - 7_000 - (WINDOW_MS + 500));
        const retry = track(writer.attachBindings(attach("rb_retry")));
        await elapse(6_000);
        expect(retry.settled).toBe(false);

        await elapse(2_000);
        expect(retry.settled).toBe(true);
        expect(retry.value).toEqual({ attached: [], duplicates: ["rb_first"] });

        await elapse(lag);
        expect(memory.grants.map((row) => row.id)).toEqual(["rb_first"]);
      });
    });
  },
);
