import {
  AuthzGrantsService as AuthzGrantsServiceContract,
  AuthzService as AuthzServiceContract,
} from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../ports/authz-grants-command-dispatcher.port";
import { AUTHZ_GRANT_PIPELINE_NAME } from "../eventing.authz.adapter";
import { PostgresAuthzAdapter } from "../postgres.authz.adapter";
import { type AuthzCounter, AuthzMetricsPort } from "../../ports/authz-metrics.port";
import type { PostgresAuthzDatabase } from "../../ports/postgres-authz-database.port";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../migrations/legacy-import.authz-grant.migration";

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

function buildDatabase() {
  const auditLog = { createMany: vi.fn(async () => ({ count: 1 })) };
  return {
    database: { auditLog } as unknown as PostgresAuthzDatabase,
    auditLog,
  };
}

/** Answers the two counters and remembers which were asked for. */
class RecordingMetrics extends AuthzMetricsPort {
  readonly asked: string[] = [];

  revocationCounter(reason: string): AuthzCounter {
    this.asked.push(`revocation:${reason}`);
    return { inc: () => {} };
  }

  engineGateReadFailureCounter(): AuthzCounter {
    this.asked.push("engine-gate-read-failure");
    return { inc: () => {} };
  }
}

describe("PostgresAuthzAdapter", () => {
  /** @scenario "A process with no metric registry composes AuthZ" */
  it("builds the complete feature without resolving runtime command handles", () => {
    const dispatcher = new RecordingDispatcher();
    const { database, auditLog } = buildDatabase();

    const built = PostgresAuthzAdapter.create({
      database,
      redis: null,
      dispatcher,
      newBindingId: () => "binding_1",
      now: () => 1_755_000_000_000,
    }).build();

    expect(Object.keys(built).sort()).toEqual(["authz", "grants", "migration", "pipeline"]);
    expect(built.authz).toBeInstanceOf(AuthzServiceContract);
    expect(built.grants).toBeInstanceOf(AuthzGrantsServiceContract);
    expect(built.pipeline.metadata.name).toBe(AUTHZ_GRANT_PIPELINE_NAME);
    expect([...built.pipeline.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
    expect([...built.pipeline.eventSubscribers.keys()]).toEqual(["auditTrail"]);
    expect(built.migration.name).toBe(AUTHZ_ENGINE_MIGRATION_NAME);
    expect(dispatcher.calls).toBe(0);
    expect(auditLog.createMany).not.toHaveBeenCalled();
  });

  describe("when the composing process renders its own metrics", () => {
    /** @scenario "A process with a metric registry counts through its own port" */
    it("resolves both counters from the port it was given", () => {
      const metrics = new RecordingMetrics();

      PostgresAuthzAdapter.create({
        database: buildDatabase().database,
        redis: null,
        dispatcher: new RecordingDispatcher(),
        metrics,
        newBindingId: () => "binding_1",
      }).build();

      expect(metrics.asked).toContain("engine-gate-read-failure");
    });
  });
});
