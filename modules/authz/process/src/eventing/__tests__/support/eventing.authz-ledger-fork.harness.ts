import type { LedgerActor } from "@langwatch/actor";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { vi } from "vitest";

import { StubAuthzEpoch } from "../../../repositories/__tests__/support/authz-epoch.stub.ts";
import type { AuthzEpochRepository } from "../../../repositories/authz-epoch.repository.ts";
import {
  type AuthzMembershipStampTransaction,
  PrismaAuthzMembershipStampRepository,
} from "../../../repositories/prisma/prisma.authz-membership-stamp.repository.ts";
import { PrismaAuthzRevocationRepository } from "../../../repositories/prisma/prisma.authz-revocation.repository.ts";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../../services/authz-grants-command-dispatcher.service.ts";
import { type AuthzLedgerDatabase, EventingAuthzLedgerAdapter } from "../../authz-grant.store.ts";

export const ORG_ID = "org_fork";
export const ACTOR: LedgerActor = { type: "user", id: "user_admin" };

const COMMAND_VERBS = [
  "attachGrant",
  "changeGrantRole",
  "revokeGrant",
  "defineRole",
  "changeRolePermissions",
  "deleteRole",
] as const;

class RecordingDispatcher extends AuthzGrantsCommandDispatcher {
  constructor(private readonly sent: { verb: string; data: unknown }[]) {
    super();
  }

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    return {
      commands: Object.fromEntries(
        COMMAND_VERBS.map((verb) => [
          verb,
          {
            send: async (data: unknown) => {
              this.sent.push({ verb, data });
            },
          },
        ]),
      ) as AuthzGrantsCommandSenders,
    };
  }
}

export function harness({
  poll,
  dispatcher,
  epoch: epochOverride,
}: {
  poll?: { intervalMs: number; timeoutMs: number };
  dispatcher?: AuthzGrantsCommandDispatcher;
  epoch?: AuthzEpochRepository;
}) {
  const sent: { verb: string; data: unknown }[] = [];
  const db = {
    roleBinding: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    role: { findFirst: vi.fn().mockResolvedValue(null) },
    grant: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      // The read-your-writes hold counts the projected rows; stubbed so a
      // case that expects it untouched can assert on it rather than on an
      // absent property.
      count: vi.fn().mockResolvedValue(0),
    },
  };
  const database: AuthzLedgerDatabase = prismaDouble(db);
  // The real repository over a stubbed client, so the fence's own SQL is what
  // the cases exercise rather than a hand-written map of stamps.
  const queryRaw = vi.fn<AuthzMembershipStampTransaction["$queryRaw"]>().mockResolvedValue([
    { userId: "user_sam", membershipStamp: "stamp_user_sam" },
    { userId: "user_alice", membershipStamp: "stamp_user_alice" },
    { userId: "user_admin", membershipStamp: "stamp_user_admin" },
  ]);
  const membershipStamps = PrismaAuthzMembershipStampRepository.create({
    database: { $transaction: async (run) => run({ $queryRaw: queryRaw }) },
  });
  const epoch = epochOverride ?? new StubAuthzEpoch();
  const revocation = PrismaAuthzRevocationRepository.create({
    database: database as never,
  });
  const writer = EventingAuthzLedgerAdapter.create({
    database,
    dispatcher: dispatcher ?? new RecordingDispatcher(sent),
    epoch,
    revocation,
    membershipStamps,
    now: () => 1_700_000_000_000,
    newCommandId: () => "authzcmd_test",
    poll: poll ?? { intervalMs: 0, timeoutMs: 0 },
  });
  return { writer, db, sent, epoch, queryRaw };
}

export const binding = {
  bindingId: "rb_1",
  principal: { userId: "user_sam" },
  role: "MEMBER" as const,
  customRoleId: null,
  scopeType: "TEAM" as const,
  scopeId: "team_support",
};

/** A live grant row as Postgres hands it back. */
export function storedGrantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rb_1",
    organizationId: ORG_ID,
    principalType: "USER",
    principalId: "user_sam",
    roleKey: "member",
    legacyRole: "MEMBER",
    source: "grants-service",
    scopeType: "TEAM",
    scopeId: "team_support",
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: new Date(0),
    ...overrides,
  };
}
