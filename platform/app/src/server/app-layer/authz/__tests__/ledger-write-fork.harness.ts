/**
 * Shared fixtures for the grant writer's per-organization fork tests
 * (ADR-092 decision 4). The fork's two sides live in their own files —
 * `ledger-write-fork.legacy.unit.test.ts` for an organization the genesis
 * import has not reached, `ledger-write-fork.ledger.unit.test.ts` for one
 * past it — and both drive the writer through this harness.
 *
 * Each test file mocks `../epoch` itself: vi.mock is per-file, so it cannot
 * live here.
 *
 * @see specs/rbac/in-place-authz-migration.feature
 */
import type { LedgerActor } from "@langwatch/authz-server";
import { vi } from "vitest";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { type AuthzGrantsCommandSenders, GrantsLedgerWriter } from "../ledger";

export const ORG_ID = "org_fork";
export const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

const COMMAND_VERBS = [
  "attachGrants",
  "changeGrantRole",
  "revokeGrants",
  "defineRoles",
  "deleteRole",
  "offboardMember",
  "proveMigrationParity",
  "completeCutover",
  "rollBackCutover",
  "recordMigrationTenantState",
] as const;

export function uniqueViolation(): Error {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
  });
}

export function recordNotFound(): Error {
  return new Prisma.PrismaClientKnownRequestError("missing", {
    code: "P2025",
    clientVersion: "test",
  });
}

export function harness({
  onLedger,
  onLedgerRevocations = onLedger,
  poll,
}: {
  onLedger: boolean;
  /**
   * The side the REVOCATION class lands on, when it has to differ from the
   * mint class's. In production the two gates answer the same question from
   * different reads — a cached genesis-state row and an uncached cutover
   * projection — so an organization the engine already serves can have its
   * mints cached onto legacy while its revocations must not be. Defaults to
   * `onLedger`, which is every test that is not about that skew.
   */
  onLedgerRevocations?: boolean;
  /** Defaults to a poll that never retries — one failed `check()` times out
   *  immediately. Override to exercise the read-your-writes retry loop. */
  poll?: { intervalMs: number; timeoutMs: number };
}) {
  const sent: Array<{ verb: string; data: unknown }> = [];
  const db = {
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue(undefined),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    customRole: {
      upsert: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    role: { findFirst: vi.fn().mockResolvedValue(null) },
    grant: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      // Known to the fold's head by default, so a test that does not care
      // about the stranded-row adoption path (`changeBindingRole`) keeps
      // taking the ordinary `changeGrantRole` branch.
      findFirst: vi.fn().mockResolvedValue({ id: "known" }),
      // Enforcement reads the revoked rows' projectIds before deleting them
      // (the resource tier's compat ShareLink head is scoped by project);
      // none here, so no share delete follows.
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const writer = new GrantsLedgerWriter(db as unknown as PrismaClient, {
    onLedgerWrites: async ({ forRevocation }) =>
      forRevocation ? onLedgerRevocations : onLedger,
    now: () => 1_700_000_000_000,
    poll: poll ?? { intervalMs: 0, timeoutMs: 0 },
    commands: async () => ({
      commands: Object.fromEntries(
        COMMAND_VERBS.map((verb) => [
          verb,
          {
            send: async (data: unknown) => {
              sent.push({ verb, data });
            },
          },
        ]),
      ) as unknown as AuthzGrantsCommandSenders,
    }),
  });
  return { writer, db, sent };
}

export const binding = {
  bindingId: "rb_1",
  principal: { userId: "user_sam" },
  role: TeamUserRole.MEMBER,
  customRoleId: null,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: "team_support",
};

/** The same binding as the legacy table's own row shape — what the batched
 *  identity pre-check reads back. */
export function legacyRow({ id }: { id: string }) {
  return {
    id,
    organizationId: ORG_ID,
    userId: "user_sam",
    groupId: null,
    apiKeyId: null,
    role: TeamUserRole.MEMBER,
    customRoleId: null,
    scopeType: RoleBindingScopeType.TEAM,
    scopeId: "team_support",
  };
}

/** The audit rows one call produced, as the row-building vocabulary shapes them. */
export function auditRows(
  db: ReturnType<typeof harness>["db"],
): Record<string, unknown>[] {
  return db.auditLog.createMany.mock.calls[0]![0].data;
}
