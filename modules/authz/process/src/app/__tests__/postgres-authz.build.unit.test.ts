import {
  AuthzGrantsService as AuthzGrantsServiceContract,
  AuthzService as AuthzServiceContract,
} from "@langwatch/authz-contract";
import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import { AUTHZ_GRANT_PIPELINE_NAME } from "../../eventing/authz-grant.pipeline.ts";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../migrations/legacy-import.authz-grant.migration.ts";
import type { PostgresAuthzDatabase } from "../../repositories/prisma/prisma.authz.database.ts";
import {
  AuthzGrantsCommandDispatcher,
  type AuthzGrantsCommandSenders,
} from "../../services/authz-grants-command-dispatcher.service.ts";
import { PostgresAuthzAdapter } from "../postgres-authz.build.ts";

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

    expect(Object.keys(built).toSorted()).toEqual(["authz", "grants", "migration", "pipeline"]);
    expect(built.authz).toBeInstanceOf(AuthzServiceContract);
    expect(built.grants).toBeInstanceOf(AuthzGrantsServiceContract);
    expect(built.pipeline.metadata.name).toBe(AUTHZ_GRANT_PIPELINE_NAME);
    expect([...built.pipeline.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
    expect([...built.pipeline.eventSubscribers.keys()]).toEqual(["auditTrail"]);
    expect(built.migration.name).toBe(AUTHZ_ENGINE_MIGRATION_NAME);
    expect(dispatcher.calls).toBe(0);
    expect(auditLog.createMany).not.toHaveBeenCalled();
  });

  describe("when a process composes AuthZ", () => {
    /** @scenario "AuthZ counts on the process registry" */
    it("renders both of its counters into the process registry", () => {
      PostgresAuthzAdapter.create({
        database: buildDatabase().database,
        redis: null,
        dispatcher: new RecordingDispatcher(),
        newBindingId: () => "binding_1",
      }).build();

      expect(register.getSingleMetric("authz_engine_gate_read_failures_total")).toBeDefined();
      expect(
        register.getSingleMetric("langwatch_authz_direct_projection_write_total"),
      ).toBeDefined();
    });
  });
});
