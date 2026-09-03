import {
  AUTHZ_GRANTS_EVENT_VERSION_LATEST,
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  type AuthzGrantPipelineDatabase,
  PostgresAuthzPipelineAdapter,
} from "../postgres.authz-pipeline.adapter";
import type { AuthzGrantsEvent } from "../eventing.authz.adapter";
import type { AuthzGrantProjection } from "../../projections/authz-grant.projection";

const ORGANIZATION = "organization_acme";
const GRANT = "grant_1";
const ACTOR = { type: "user", id: "user_admin" } as const;

function recordingDatabase(options: { guard?: number; grantRow?: unknown } = {}) {
  const executeRaw = vi.fn(async () => options.guard ?? 1);
  const grantFindUnique = vi.fn(async () => options.grantRow ?? null);
  const roleBindingUpsert = vi.fn(async () => undefined);
  const roleBindingDeleteMany = vi.fn(async () => ({ count: 0 }));
  const shareLinkDeleteMany = vi.fn(async () => ({ count: 0 }));
  const auditCreateMany = vi.fn(async () => ({ count: 1 }));
  const database = {
    grant: {
      findUnique: grantFindUnique,
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => undefined),
    },
    role: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => undefined),
    },
    roleBinding: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: roleBindingDeleteMany,
      upsert: roleBindingUpsert,
    },
    customRole: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async () => undefined),
    },
    shareLink: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: shareLinkDeleteMany,
      upsert: vi.fn(async () => undefined),
    },
    auditLog: { createMany: auditCreateMany },
    $transaction: vi.fn(async (writes: Promise<unknown>[]) => Promise.all(writes)),
    $executeRaw: executeRaw,
  } as unknown as AuthzGrantPipelineDatabase;

  return {
    database,
    executeRaw,
    grantFindUnique,
    roleBindingUpsert,
    roleBindingDeleteMany,
    shareLinkDeleteMany,
    auditCreateMany,
  };
}

function compose(options: { guard?: number; grantRow?: unknown } = {}) {
  const recording = recordingDatabase(options);
  const pipeline = PostgresAuthzPipelineAdapter.create({ database: recording.database }).build();
  return { ...recording, pipeline };
}

function grantsProjection(pipeline: ReturnType<typeof compose>["pipeline"]): AuthzGrantProjection {
  const registered = pipeline.mapProjections.get("authzGrantsWrite");
  expect(registered, "the pipeline registered no authzGrantsWrite projection").toBeDefined();
  return registered!.definition as unknown as AuthzGrantProjection;
}

function event(type: string, data: Record<string, unknown>, occurredAt: number): AuthzGrantsEvent {
  return {
    id: `event_${occurredAt}`,
    aggregateId: GRANT,
    aggregateType: "authz_grant",
    tenantId: createTenantId(ORGANIZATION),
    createdAt: occurredAt,
    occurredAt,
    type,
    version: AUTHZ_GRANTS_EVENT_VERSION_LATEST,
    data,
  } as unknown as AuthzGrantsEvent;
}

function attachedEvent(): AuthzGrantsEvent {
  return event(
    GRANT_ATTACHED_EVENT_TYPE,
    {
      grantId: GRANT,
      principal: { type: "user", id: "user_sam" },
      roleKey: "member",
      scope: { type: "TEAM", id: "team_1" },
      source: "grants-service",
      actor: ACTOR,
    },
    1_700_000_000_000,
  );
}

async function applyAttached(composed: ReturnType<typeof compose>): Promise<void> {
  const projection = grantsProjection(composed.pipeline);
  await projection.store.append(projection.map(attachedEvent()), {} as ProjectionStoreContext);
}

describe("PostgresAuthzPipelineAdapter", () => {
  describe("given a process holding one typed Prisma client", () => {
    /**
     * Frozen twin: `PipelineRegistry.registerAll` registers the App's own
     * `AuthzFeature.pipeline`, built by `PostgresAuthzAdapter` from this same
     * `EventingAuthzAdapter`, and both graphs route
     * `${pipeline}:${jobType}:${jobName}` off one `event-sourcing/jobs` queue.
     * The names are LITERAL here rather than imported, because the failure
     * this catches is a rename that moved both the constant and its use — the
     * checked-in `apps/worker/src/features/job-registry.json` names exactly
     * these keys, and an unroutable job is redelivered forever rather than
     * dropped.
     */
    /** @scenario "The worker builds the grants ledger from its own client" */
    it("builds the pipeline the legacy registry registers, key for key", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("authz_grant");
      expect(pipeline.aggregate.type).toBe("authz_grant");
      expect(pipeline.commands.map((command) => command.name)).toEqual([
        "attachGrant",
        "changeGrantRole",
        "revokeGrant",
        "defineRole",
        "changeRolePermissions",
        "deleteRole",
      ]);
      expect([...pipeline.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
      expect([...pipeline.eventSubscribers.keys()]).toEqual(["auditTrail"]);
      // The ledger is a consumer here; no process manager wakes on a timer.
      expect([...pipeline.processManagers.keys()]).toEqual([]);
    });

    /**
     * ADR-114 (amended): every command about ONE grant rides ONE lane, and
     * `serializeByAggregate` is what drops the command NAME from the job path
     * so an `attachGrant` and the `revokeGrant` behind it queue rather than
     * race. The projection's guard cannot recover that order on its own — a
     * revoke that arrives first matches nothing, and the late attach then
     * inserts a live row no revocation contradicts.
     */
    /** @scenario "One grant's commands ride one ordered lane" */
    it("keeps the three grant commands on one aggregate lane and the role commands off it", () => {
      const { pipeline } = compose();
      const optionsFor = (name: string) =>
        pipeline.commands.find((command) => command.name === name)?.options;

      for (const name of ["attachGrant", "changeGrantRole", "revokeGrant"]) {
        expect(optionsFor(name), name).toMatchObject({
          serializeByAggregate: true,
          coalesceMaxBatch: 50,
        });
      }
      for (const name of ["defineRole", "changeRolePermissions", "deleteRole"]) {
        expect(optionsFor(name)?.serializeByAggregate, name).toBeUndefined();
      }
    });

    /**
     * The grant expansion, end to end over one client: an `attached` becomes
     * the guarded upsert onto the authoritative `Grant` head AND the legacy
     * `RoleBinding` the resolver, the settings screens and the revoke-by-filter
     * path still read. A graph that wrote only the authoritative head would
     * leave an organization that has not finalized unable to roll back.
     */
    /** @scenario "One grant event expands onto both heads through one client" */
    it("expands an attached grant onto the authoritative head and its legacy binding", async () => {
      const composed = compose({ guard: 1 });

      await applyAttached(composed);

      expect(composed.executeRaw).toHaveBeenCalledTimes(1);
      const [statement] = composed.executeRaw.mock.calls[0] as unknown as [string[]];
      expect(statement.join("?")).toContain('INSERT INTO "Grant"');
      // The guard is part of the statement, never a read-then-write.
      expect(statement.join("?")).toContain('WHERE "Grant"."occurredAt" < EXCLUDED."occurredAt"');

      expect(composed.roleBindingUpsert).toHaveBeenCalledTimes(1);
      expect(composed.roleBindingUpsert).toHaveBeenCalledWith({
        where: { organizationId: ORGANIZATION, id: GRANT },
        create: {
          id: GRANT,
          organizationId: ORGANIZATION,
          userId: "user_sam",
          groupId: null,
          apiKeyId: null,
          role: "MEMBER",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team_1",
        },
        update: {
          organizationId: ORGANIZATION,
          userId: "user_sam",
          groupId: null,
          apiKeyId: null,
          role: "MEMBER",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team_1",
        },
      });
      // The guard won, so the compat head is derived from the event with no
      // second read of the row it just wrote.
      expect(composed.grantFindUnique).not.toHaveBeenCalled();
    });

    /**
     * The load-bearing half of the same expansion. A redelivered OLDER
     * `attached` loses the guard and leaves the grant revoked; rebuilding the
     * compat head from that stale event would re-insert the very binding the
     * revoke deleted, resurrecting access on the head the legacy resolver
     * reads. So a lost guard re-reads, and a revoked row has its compat rows
     * removed instead.
     */
    /** @scenario "A redelivered older attach never resurrects a revoked binding" */
    it("removes the legacy binding when a redelivered attach loses the guard", async () => {
      const composed = compose({
        guard: 0,
        grantRow: {
          id: GRANT,
          organizationId: ORGANIZATION,
          principalType: "USER",
          principalId: "user_sam",
          roleKey: "member",
          legacyRole: null,
          source: "grants-service",
          scopeType: "TEAM",
          scopeId: "team_1",
          token: null,
          permission: null,
          resourceKind: null,
          projectId: null,
          createdByUserId: null,
          expiresAt: null,
          maxViews: null,
          occurredAt: new Date(1_700_000_001_000),
          revokedAt: new Date(1_700_000_001_000),
        },
      });

      await applyAttached(composed);

      expect(composed.grantFindUnique).toHaveBeenCalledTimes(1);
      expect(composed.roleBindingUpsert).not.toHaveBeenCalled();
      expect(composed.roleBindingDeleteMany).toHaveBeenCalledWith({
        where: { organizationId: ORGANIZATION, id: GRANT },
      });
    });

    /**
     * The audit trail is the ledger's other Postgres binding, and it rides the
     * same client. Idempotent by the event-derived row id: a redelivered
     * subscriber action is a successful no-op, never an update of an immutable
     * audit fact.
     */
    /** @scenario "The worker writes the grants audit trail through the same client" */
    it("inserts the audit row through the same client, idempotently", async () => {
      const { pipeline, auditCreateMany } = compose();
      const subscriber = pipeline.eventSubscribers.get("auditTrail")!;

      await subscriber.handle(
        event(
          GRANT_REVOKED_EVENT_TYPE,
          { grantId: GRANT, reason: "offboard", actor: ACTOR },
          1_700_000_000_000,
        ),
        {} as never,
      );

      expect(auditCreateMany).toHaveBeenCalledWith({
        data: [
          {
            id: "authz-evt-event_1700000000000",
            createdAt: new Date(1_700_000_000_000),
            userId: "user_admin",
            organizationId: ORGANIZATION,
            action: "authz.grants.revoke",
            metadata: { grantId: GRANT, reason: "offboard" },
          },
        ],
        skipDuplicates: true,
      });
    });
  });
});
