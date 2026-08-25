import {
  AuthzGrantsService as AuthzGrantsServiceContract,
  AuthzService as AuthzServiceContract,
} from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../src/ports/authz-grants-command-dispatcher.port";
import { AUTHZ_GRANT_PIPELINE_NAME } from "../../src/adapters/eventing.authz.adapter";
import {
  AuthzCutoverFailureReporter,
  type AuthzCutoverReadFailure,
} from "../../src/adapters/postgres.authz-cutover.adapter";
import { PostgresAuthzAdapter } from "../../src/adapters/postgres.authz.adapter";
import type { PostgresAuthzDatabase } from "../../src/ports/postgres-authz-database.port";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../src/migrations/legacy-import.authz-grant.migration";
import {
  type AuthzRevocationReason,
  AuthzRevocationTelemetry,
} from "../../src/ports/authz-revocation-telemetry.port";

class RecordingDispatcher extends AuthzGrantsCommandDispatcher {
  calls = 0;

  private readonly send = vi.fn(async () => undefined);

  async commands(): Promise<{ commands: AuthzGrantsCommandSenders }> {
    this.calls += 1;
    return {
      commands: {
        attachGrant: { send: this.send },
        changeGrantRole: { send: this.send },
        revokeGrant: { send: this.send },
        defineRole: { send: this.send },
        changeRolePermissions: { send: this.send },
        deleteRole: { send: this.send },
      },
    };
  }
}

class NullCutoverReporter extends AuthzCutoverFailureReporter {
  report(_failure: AuthzCutoverReadFailure): void {}
}

class NullRevocationTelemetry extends AuthzRevocationTelemetry {
  record(_args: {
    organizationId: string;
    reason: AuthzRevocationReason;
    grantCount: number;
  }): void {}
}

function buildDatabase() {
  const auditLog = { createMany: vi.fn(async () => ({ count: 1 })) };
  return {
    database: { auditLog } as unknown as PostgresAuthzDatabase,
    auditLog,
  };
}

describe("PostgresAuthzAdapter", () => {
  it("builds the complete feature without resolving runtime command handles", () => {
    const dispatcher = new RecordingDispatcher();
    const { database, auditLog } = buildDatabase();

    const built = PostgresAuthzAdapter.create({
      database,
      redis: null,
      dispatcher,
      cutoverReporter: new NullCutoverReporter(),
      revocationTelemetry: new NullRevocationTelemetry(),
      newBindingId: () => "binding_1",
      now: () => 1_755_000_000_000,
    }).build();

    expect(Object.keys(built).sort()).toEqual([
      "authz",
      "grants",
      "migration",
      "pipeline",
    ]);
    expect(built.authz).toBeInstanceOf(AuthzServiceContract);
    expect(built.grants).toBeInstanceOf(AuthzGrantsServiceContract);
    expect(built.pipeline.metadata.name).toBe(AUTHZ_GRANT_PIPELINE_NAME);
    expect([...built.pipeline.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
    expect([...built.pipeline.eventSubscribers.keys()]).toEqual(["auditTrail"]);
    expect(built.migration.name).toBe(AUTHZ_ENGINE_MIGRATION_NAME);
    expect(dispatcher.calls).toBe(0);
    expect(auditLog.createMany).not.toHaveBeenCalled();
  });
});
