import type { LedgerActor } from "@langwatch/actor";
import { vi } from "vitest";
import {
  type AuthzLedgerDatabase,
  EventingAuthzLedgerAdapter,
} from "../../eventing.authz-ledger.adapter";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../../ports/authz-grants-command-dispatcher.port";
import {
  AuthzCutoverFailureReporter,
  PostgresAuthzCutoverAdapter,
} from "../../postgres.authz-cutover.adapter";
import type { AuthzEpochPort } from "../../../ports/authz-epoch.port";
import { AuthzRevocationTelemetry } from "../../../ports/authz-revocation-telemetry.port";
import { PrismaAuthzRevocationRepository } from "../../../repositories/prisma/prisma.authz-revocation.repository";
import { StubAuthzEpoch } from "../../../ports/__tests__/support/authz-epoch.stub";

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

class SilentReporter extends AuthzCutoverFailureReporter {
  report(): void {}
}

class SilentRevocationTelemetry extends AuthzRevocationTelemetry {
  record(): void {}
}

class RecordingDispatcher extends AuthzGrantsCommandDispatcher {
  constructor(private readonly sent: Array<{ verb: string; data: unknown }>) {
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

export function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error("duplicate"), { code: "P2002" });
}

export function recordNotFound(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "P2025" });
}

export function harness({
  onLedger,
  poll,
  dispatcher,
  epoch: epochOverride,
}: {
  onLedger: boolean;
  poll?: { intervalMs: number; timeoutMs: number };
  dispatcher?: AuthzGrantsCommandDispatcher;
  epoch?: AuthzEpochPort;
}) {
  const sent: Array<{ verb: string; data: unknown }> = [];
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
    customRole: {
      upsert: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    role: { findFirst: vi.fn().mockResolvedValue(null) },
    grant: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue({ id: "known" }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    shareLink: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const database = db as unknown as AuthzLedgerDatabase;
  const epoch = epochOverride ?? new StubAuthzEpoch();
  const cutover = PostgresAuthzCutoverAdapter.create({
    database: {
      systemMigrationTenantState: {
        findUnique: vi.fn().mockResolvedValue(onLedger ? { status: "finalized" } : null),
      },
    },
    reporter: new SilentReporter(),
  });
  const revocation = PrismaAuthzRevocationRepository.create({
    database: database as never,
    telemetry: new SilentRevocationTelemetry(),
  });
  const writer = EventingAuthzLedgerAdapter.create({
    database,
    dispatcher: dispatcher ?? new RecordingDispatcher(sent),
    cutover,
    epoch,
    revocation,
    now: () => 1_700_000_000_000,
    newCommandId: () => "authzcmd_test",
    poll: poll ?? { intervalMs: 0, timeoutMs: 0 },
  });
  return { writer, db, sent, epoch };
}

export const binding = {
  bindingId: "rb_1",
  principal: { userId: "user_sam" },
  role: "MEMBER" as const,
  customRoleId: null,
  scopeType: "TEAM" as const,
  scopeId: "team_support",
};

export function legacyRow({ id }: { id: string }) {
  return {
    id,
    organizationId: ORG_ID,
    userId: "user_sam",
    groupId: null,
    apiKeyId: null,
    role: "MEMBER" as const,
    customRoleId: null,
    scopeType: "TEAM" as const,
    scopeId: "team_support",
  };
}

export function auditRows(
  db: ReturnType<typeof harness>["db"],
): Record<string, unknown>[] {
  return db.auditLog.createMany.mock.calls[0]![0].data;
}
