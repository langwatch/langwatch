import {
  emptyGrantsLedgerState,
  type GrantEventSource,
  type GrantFact,
  grantFactToRow,
  type RoleFact,
  roleFactToRow,
} from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { createTenantId } from "~/server/event-sourcing";
import type { AuthzGrantsFoldState } from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsState.foldProjection";
import type { StoredProjection } from "~/server/event-sourcing/projections/stateProjection.types";
import { PrismaAuthzGrantsProjectionRepository } from "../authz-grants-projection.prisma.repository";

const ORG = "org_1";
const STAMP = 1_700_000_000_000;

/**
 * The direct-write paths' Prisma: the revocation enforcement reads the
 * projectIds off the `Grant` rows before deleting them, because `ShareLink`
 * has no organization column to scope a bulk delete by.
 */
function makePrisma({
  revokedProjectIds = [],
}: {
  revokedProjectIds?: (string | null)[];
} = {}) {
  return {
    grant: {
      findMany: vi.fn(async () =>
        revokedProjectIds.map((projectId) => ({ projectId })),
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    roleBinding: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    shareLink: { deleteMany: vi.fn(async () => ({ count: 0 })) },
  } as unknown as PrismaClient;
}

function grantFact(overrides: Partial<GrantFact> = {}): GrantFact {
  return {
    grantId: "grant_a",
    principal: { type: "user", id: "user_sam" },
    roleKey: "member",
    scope: { type: "TEAM", id: "team_support" },
    source: "backfill-b",
    occurredAtMs: 1_690_000_000_000,
    ...overrides,
  };
}

/** A resource-tier fact: the share-link heritage, ADR-057 possession intact. */
function shareGrantFact({
  grantId = "grant_share_1",
  source = "grants-service",
}: {
  grantId?: string;
  source?: GrantEventSource;
} = {}): GrantFact {
  return grantFact({
    grantId,
    principal: { type: "anyone", id: null },
    roleKey: null,
    scope: { type: "RESOURCE", id: "trace_t1" },
    resource: {
      kind: "trace",
      projectId: "proj_chatbot",
      token: `tok_${grantId}`,
      permission: "traces:view",
      createdByUserId: "user_sam",
    },
    source,
  });
}

function roleFact(overrides: Partial<RoleFact> = {}): RoleFact {
  return {
    roleId: "role_sre",
    name: "SRE",
    permissions: ["analytics:view"],
    kind: "custom",
    occurredAtMs: 1_690_000_000_000,
    ...overrides,
  };
}

type MigrationRow = {
  migrationName: string;
  status: string;
  occurredAt: Date;
};

/**
 * Prisma stubbed down to the calls `store()` makes. Every write is a spy, so
 * a test can assert the SHAPE of the guard rather than a row count from a
 * database this suite deliberately does not have. The READS are stubbed too,
 * because `store()` is a delta: what it writes is a function of what storage
 * already holds.
 */
function makeStorePrisma({
  cursorPresent = true,
  storedGrants = [],
  storedRoles = [],
  storedMigrations = [],
  migrationUpdateCount = 1,
  bindingReferences = [],
  teamUserReferences = [],
  roleBindingUpsert = vi.fn(async () => undefined),
  roleBindingUpdateMany = vi.fn(async () => ({ count: 1 })),
  customRoleUpsert = vi.fn(async () => undefined),
  shareLinkUpsert = vi.fn(
    async (_args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => undefined,
  ),
  shareLinkUpdateMany = vi.fn(async () => ({ count: 1 })),
}: {
  cursorPresent?: boolean;
  storedGrants?: GrantFact[];
  storedRoles?: RoleFact[];
  storedMigrations?: MigrationRow[];
  migrationUpdateCount?: number;
  bindingReferences?: string[];
  teamUserReferences?: string[];
  roleBindingUpsert?: ReturnType<typeof vi.fn>;
  roleBindingUpdateMany?: ReturnType<typeof vi.fn>;
  customRoleUpsert?: ReturnType<typeof vi.fn>;
  shareLinkUpsert?: ReturnType<typeof vi.fn>;
  shareLinkUpdateMany?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    authzProjectionCursor: {
      findUnique: vi.fn(async () =>
        cursorPresent ? { organizationId: ORG } : null,
      ),
      upsert: vi.fn(),
    },
    grant: {
      findMany: vi.fn(async () =>
        storedGrants.map((grant) =>
          grantFactToRow({ grant, organizationId: ORG }),
        ),
      ),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    role: {
      findMany: vi.fn(async () =>
        storedRoles.map((role) => roleFactToRow({ role, organizationId: ORG })),
      ),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    roleBinding: {
      findMany: vi.fn(async () =>
        bindingReferences.map((customRoleId) => ({ customRoleId })),
      ),
      deleteMany: vi.fn(),
      upsert: roleBindingUpsert,
      updateMany: roleBindingUpdateMany,
    },
    shareLink: {
      deleteMany: vi.fn(),
      upsert: shareLinkUpsert,
      updateMany: shareLinkUpdateMany,
    },
    teamUser: {
      findMany: vi.fn(async () =>
        teamUserReferences.map((assignedRoleId) => ({ assignedRoleId })),
      ),
    },
    customRole: { deleteMany: vi.fn(), upsert: customRoleUpsert },
    authzCutoverProjection: { upsert: vi.fn() },
    systemMigrationTenantState: {
      findMany: vi.fn(async () =>
        storedMigrations.map((row) => ({
          ...row,
          report: null,
          tenantId: ORG,
        })),
      ),
      updateMany: vi.fn(async () => ({ count: migrationUpdateCount })),
      createMany: vi.fn(async () => ({ count: 1 })),
    },
  } as unknown as PrismaClient;
}

function storedProjection({
  grants = [],
  roles = [],
  migrationStates = {},
}: {
  grants?: GrantFact[];
  roles?: RoleFact[];
  migrationStates?: Record<
    string,
    {
      status: "migrated" | "finalized" | "parked" | "rolled_back";
      occurredAtMs: number;
    }
  >;
} = {}): StoredProjection<AuthzGrantsFoldState> {
  return {
    state: {
      ...emptyGrantsLedgerState({ organizationId: ORG }),
      grants: Object.fromEntries(
        grants.map((grant) => [grant.grantId, grant] as const),
      ),
      roles: Object.fromEntries(
        roles.map((role) => [role.roleId, role] as const),
      ),
      migrationStates,
      // The fold state is the reducer's state plus the base class's three
      // bookkeeping stamps; `store()` is typed against that, not the bare
      // reducer state.
      CreatedAt: STAMP,
      UpdatedAt: STAMP,
      LastEventOccurredAt: STAMP,
    },
    cursor: { acceptedAt: STAMP, eventId: "evt_1" },
    occurredAt: STAMP,
    createdAt: STAMP,
    updatedAt: STAMP,
    version: "2026-08-17",
  };
}

const CONTEXT = { aggregateId: ORG, tenantId: createTenantId(ORG) };

function prismaConflict(code: string) {
  return new Prisma.PrismaClientKnownRequestError("conflict", {
    code,
    clientVersion: "test",
  });
}

describe("PrismaAuthzGrantsProjectionRepository", () => {
  describe("when an operator rolls a cut-over organization back", () => {
    /** @scenario "Rolling back a cutover takes effect without a deploy, even with the queue stopped" */
    it("writes onEngine false on the row the request-path gate reads", async () => {
      const upsert = vi.fn(async () => ({}));
      const repository = new PrismaAuthzGrantsProjectionRepository({
        authzCutoverProjection: { upsert },
      } as unknown as PrismaClient);

      await repository.enforceCutoverRollback({ organizationId: ORG });

      expect(upsert).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        // The create half covers an organization with no projection row yet;
        // the update half is the flip itself. Neither touches anything else,
        // which is what keeps this write deny-only.
        create: { organizationId: ORG, onEngine: false },
        update: { onEngine: false },
      });
    });
  });

  describe("when a revocation is enforced on the calling path", () => {
    it("deletes both heads keyed by organization and the named grant ids only", async () => {
      const prisma = makePrisma({ revokedProjectIds: [null, null] });
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: ORG,
        grantIds: ["grant_a", "grant_b"],
      });

      const scoped = {
        where: { organizationId: ORG, id: { in: ["grant_a", "grant_b"] } },
      };
      expect(prisma.grant.deleteMany).toHaveBeenCalledWith(scoped);
      // Compat rows share the grant id, so a legacy-authored binding can
      // never be collateral - its id is not a grant id.
      expect(prisma.roleBinding.deleteMany).toHaveBeenCalledWith(scoped);
      // No resource grant among them, so no project to scope a share
      // deletion by - and nothing to delete.
      expect(prisma.shareLink.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the revocation names a resource grant", () => {
    it("deletes the share row too, scoped by the project it read first", async () => {
      const prisma = makePrisma({ revokedProjectIds: ["proj_chatbot"] });
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: ORG,
        grantIds: ["grant_share_1"],
      });

      // The projectId has to come off the Grant row before that row is
      // deleted: ShareLink has no organizationId, and the multitenancy
      // guard rejects a bulk delete that cannot name a project.
      expect(prisma.grant.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG, id: { in: ["grant_share_1"] } },
        select: { projectId: true },
      });
      expect(prisma.shareLink.deleteMany).toHaveBeenCalledWith({
        where: {
          projectId: { in: ["proj_chatbot"] },
          id: { in: ["grant_share_1"] },
        },
      });
    });
  });

  describe("when the fold already applied the revocation", () => {
    it("leaves the share rows alone, since the same pass removed them", async () => {
      const prisma = makePrisma({ revokedProjectIds: [] });
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: ORG,
        grantIds: ["grant_share_1"],
      });

      expect(prisma.shareLink.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when the revocation names no grants", () => {
    it("touches nothing", async () => {
      const prisma = makePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.enforceGrantRevocation({
        organizationId: ORG,
        grantIds: [],
      });

      expect(prisma.grant.deleteMany).not.toHaveBeenCalled();
      expect(prisma.roleBinding.deleteMany).not.toHaveBeenCalled();
      expect(prisma.shareLink.deleteMany).not.toHaveBeenCalled();
    });
  });

  /**
   * `store()` writes a DELTA. Re-upserting every grant on every event
   * resurrected compat rows the legacy paths had deleted, collided with the
   * partial unique indexes when a member was removed and re-added, and
   * bumped every migration row's `updatedAt`. So "wrote nothing" is the
   * assertion that matters most here.
   */
  describe("given a folded state that storage already holds", () => {
    describe("when it is stored again", () => {
      it("issues no head or compat writes at all", async () => {
        const grant = grantFact();
        const share = shareGrantFact();
        const role = roleFact();
        const prisma = makeStorePrisma({
          storedGrants: [grant, share],
          storedRoles: [role],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({ grants: [grant, share], roles: [role] }),
          CONTEXT,
        );

        expect(prisma.grant.upsert).not.toHaveBeenCalled();
        expect(prisma.roleBinding.upsert).not.toHaveBeenCalled();
        // The resource tier is delta-tracked like every other fact: an
        // unchanged share link is not rewritten, so a legacy edit to the row
        // is not undone on every unrelated event.
        expect(prisma.shareLink.upsert).not.toHaveBeenCalled();
        expect(prisma.role.upsert).not.toHaveBeenCalled();
        expect(prisma.customRole.upsert).not.toHaveBeenCalled();
        expect(prisma.grant.deleteMany).not.toHaveBeenCalled();
        expect(prisma.roleBinding.deleteMany).not.toHaveBeenCalled();
        expect(prisma.shareLink.deleteMany).not.toHaveBeenCalled();
        // The cursor still advances - the batch WAS applied, it just
        // changed nothing this store had to write.
        expect(prisma.authzProjectionCursor.upsert).toHaveBeenCalledTimes(1);
      });
    });

    describe("when one grant's role changed", () => {
      it("writes that grant only, compat row before its head", async () => {
        const before = grantFact();
        const untouched = grantFact({
          grantId: "grant_b",
          principal: { type: "user", id: "user_robin" },
        });
        const after = grantFact({ roleKey: "admin" });
        const prisma = makeStorePrisma({
          storedGrants: [before, untouched],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({ grants: [after, untouched] }),
          CONTEXT,
        );

        expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.grant.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { organizationId: ORG, id: "grant_a" },
          }),
        );
        expect(prisma.roleBinding.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.roleBinding.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({ id: "grant_a", role: "ADMIN" }),
          }),
        );
        // The head row is the fact's commit marker: written last, so a crash
        // between the two leaves the marker stale and the re-run redoes both.
        expect(
          vi.mocked(prisma.roleBinding.upsert).mock.invocationCallOrder[0],
        ).toBeLessThan(
          vi.mocked(prisma.grant.upsert).mock.invocationCallOrder[0]!,
        );
      });
    });

    describe("when only a share link's terms changed", () => {
      it("rewrites that share row, because the fingerprint sees the resource columns", async () => {
        const before = shareGrantFact();
        const after = shareGrantFact();
        after.resource = { ...after.resource!, maxViews: 5 };
        const prisma = makeStorePrisma({ storedGrants: [before] });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection({ grants: [after] }), CONTEXT);

        expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.shareLink.upsert).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a grant the genesis import adopted from a legacy row", () => {
    /** @scenario "An imported grant updates the row it adopted and never authors a new one" */
    it("updates the adopted binding row and never authors a new one", async () => {
      const prisma = makeStorePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.store(
        storedProjection({
          grants: [grantFact({ grantId: "rb_1", source: "genesis-import" })],
        }),
        CONTEXT,
      );

      // The import adopts ids that already exist; a row that is absent is a
      // fact the legacy schema never stored (the floor row, the admin
      // fallback), and creating one here would put a new legacy-visible
      // binding in front of the resolver while the organization is dark.
      expect(prisma.roleBinding.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, id: "rb_1" } }),
      );
      expect(prisma.roleBinding.upsert).not.toHaveBeenCalled();
      // The Grant head is written for every source, always as an upsert.
      expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a grant from any other source", () => {
    /** @scenario "The compat rows are authored by the fold alone" */
    it("keeps writing the compat row through the upsert", async () => {
      const prisma = makeStorePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.store(
        storedProjection({
          grants: [grantFact({ grantId: "grant_1", source: "grants-service" })],
        }),
        CONTEXT,
      );

      expect(prisma.roleBinding.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.roleBinding.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("given a resource grant the fold is storing", () => {
    it("writes the Grant head and the share link the legacy reads use", async () => {
      const shareLinkUpsert = vi.fn(
        async (_args: {
          where: Record<string, unknown>;
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => undefined,
      );
      const prisma = makeStorePrisma({ shareLinkUpsert });
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.store(
        storedProjection({ grants: [shareGrantFact()] }),
        CONTEXT,
      );

      expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
      expect(shareLinkUpsert).toHaveBeenCalledTimes(1);
      // A resource fact has no legacy binding to be - only a share row.
      expect(prisma.roleBinding.upsert).not.toHaveBeenCalled();

      expect(shareLinkUpsert.mock.calls[0]?.[0]).toEqual({
        where: { projectId: "proj_chatbot", id: "grant_share_1" },
        create: expect.objectContaining({
          id: "grant_share_1",
          token: "tok_grant_share_1",
          resourceType: "TRACE",
          resourceId: "trace_t1",
          projectId: "proj_chatbot",
          userId: "user_sam",
          visibility: "PUBLIC",
        }),
        update: expect.objectContaining({ token: "tok_grant_share_1" }),
      });
    });

    it("never names viewCount, so ShareService's accounting survives the pass", async () => {
      const shareLinkUpsert = vi.fn(
        async (_args: {
          where: Record<string, unknown>;
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => undefined,
      );
      const prisma = makeStorePrisma({ shareLinkUpsert });
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.store(
        storedProjection({ grants: [shareGrantFact()] }),
        CONTEXT,
      );

      const args = shareLinkUpsert.mock.calls[0]?.[0];
      expect(Object.keys(args?.create ?? {})).not.toContain("viewCount");
      expect(Object.keys(args?.update ?? {})).not.toContain("viewCount");
    });
  });

  describe("given a resource grant the cutover import adopted", () => {
    it("updates the share row it adopted and never authors a new one", async () => {
      const prisma = makeStorePrisma();
      const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

      await repository.store(
        storedProjection({
          grants: [
            shareGrantFact({ grantId: "sl_1", source: "cutover-import" }),
          ],
        }),
        CONTEXT,
      );

      // The import adopts the ShareLink's own id, so the original row IS the
      // compat row; a missing row means there is nothing to converge onto.
      expect(prisma.shareLink.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj_chatbot", id: "sl_1" },
        }),
      );
      expect(prisma.shareLink.upsert).not.toHaveBeenCalled();
      expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a grant that left the folded state", () => {
    describe("when the state was reconstructed from storage", () => {
      it("deletes its head and its compat row, and nothing else", async () => {
        const departed = grantFact();
        const kept = grantFact({
          grantId: "grant_b",
          principal: { type: "user", id: "user_robin" },
        });
        const prisma = makeStorePrisma({ storedGrants: [departed, kept] });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection({ grants: [kept] }), CONTEXT);

        const scoped = {
          where: { organizationId: ORG, id: { in: ["grant_a"] } },
        };
        expect(prisma.grant.deleteMany).toHaveBeenCalledWith(scoped);
        // Keyed by the grant id that LEFT, never by a diff of the whole
        // table - a legacy-authored binding's id is not a grant id, so it
        // can never be collateral.
        expect(prisma.roleBinding.deleteMany).toHaveBeenCalledWith(scoped);
        expect(prisma.roleBinding.deleteMany).toHaveBeenCalledTimes(1);
        // No departed fact named a project, so there is nothing for the
        // share delete to scope itself by - and it is not issued.
        expect(prisma.shareLink.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when the departed fact is a resource grant", () => {
      it("deletes the share row it authored, scoped by that row's own project", async () => {
        const prisma = makeStorePrisma({ storedGrants: [shareGrantFact()] });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection(), CONTEXT);

        expect(prisma.grant.deleteMany).toHaveBeenCalledWith({
          where: { organizationId: ORG, id: { in: ["grant_share_1"] } },
        });
        expect(prisma.shareLink.deleteMany).toHaveBeenCalledWith({
          where: {
            projectId: { in: ["proj_chatbot"] },
            id: { in: ["grant_share_1"] },
          },
        });
      });
    });

    /**
     * `load()` returns null when the cursor row is absent, and the executor
     * then folds from EMPTY. The state in hand describes this batch's events
     * alone, so every other grant the organization owns would read as
     * departed - and the pruning below would delete the lot, both heads.
     */
    describe("when there was no cursor row to reconstruct from", () => {
      it("prunes nothing, however many rows storage holds", async () => {
        const prisma = makeStorePrisma({
          cursorPresent: false,
          storedGrants: [grantFact(), shareGrantFact()],
          storedRoles: [roleFact()],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection(), CONTEXT);

        expect(prisma.grant.deleteMany).not.toHaveBeenCalled();
        expect(prisma.roleBinding.deleteMany).not.toHaveBeenCalled();
        expect(prisma.shareLink.deleteMany).not.toHaveBeenCalled();
        expect(prisma.role.deleteMany).not.toHaveBeenCalled();
        expect(prisma.customRole.deleteMany).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * Deleting a `CustomRole` nulls `customRoleId` on every `RoleBinding` and
   * `TeamUser` pointing at it (SetNull), and imported roles keep their legacy
   * CustomRole id. A legacy row left with `role = CUSTOM` and no custom role
   * resolves to viewer - a silent permission downgrade authored by a
   * projection.
   */
  describe("given a role that left the folded state", () => {
    describe("when a legacy row still references its compat custom role", () => {
      it("keeps the compat row and retires the future head only", async () => {
        const prisma = makeStorePrisma({
          storedRoles: [roleFact()],
          bindingReferences: ["role_sre"],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection(), CONTEXT);

        expect(prisma.customRole.deleteMany).not.toHaveBeenCalled();
        expect(prisma.role.deleteMany).toHaveBeenCalledWith({
          where: { organizationId: ORG, id: { in: ["role_sre"] } },
        });
      });

      it("also counts a TeamUser assignment as a reference", async () => {
        const prisma = makeStorePrisma({
          storedRoles: [roleFact()],
          teamUserReferences: ["role_sre"],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection(), CONTEXT);

        expect(prisma.customRole.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe("when nothing references it", () => {
      it("removes both heads", async () => {
        const prisma = makeStorePrisma({ storedRoles: [roleFact()] });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection(), CONTEXT);

        expect(prisma.customRole.deleteMany).toHaveBeenCalledWith({
          where: { organizationId: ORG, id: { in: ["role_sre"] } },
        });
        expect(prisma.role.deleteMany).toHaveBeenCalledWith({
          where: { organizationId: ORG, id: { in: ["role_sre"] } },
        });
      });
    });
  });

  /**
   * A throw here escapes before `writeCursor`, so the organization's
   * projection queue re-runs the same batch forever: one conflicting row
   * would park the whole lane. Neither conflict is retryable, so both are
   * warned and stepped over.
   */
  describe("given a compat write that collides with a legacy-authored row", () => {
    describe("when the binding upsert raises a unique violation", () => {
      it("still lands the future head and still advances the cursor", async () => {
        const prisma = makeStorePrisma({
          roleBindingUpsert: vi.fn(async () => {
            throw prismaConflict("P2002");
          }),
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await expect(
          repository.store(
            storedProjection({ grants: [grantFact()] }),
            CONTEXT,
          ),
        ).resolves.toBeUndefined();

        expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.authzProjectionCursor.upsert).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the share upsert raises a token collision", () => {
      it("still lands the future head and still advances the cursor", async () => {
        const prisma = makeStorePrisma({
          shareLinkUpsert: vi.fn(async () => {
            throw prismaConflict("P2002");
          }),
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await expect(
          repository.store(
            storedProjection({ grants: [shareGrantFact()] }),
            CONTEXT,
          ),
        ).resolves.toBeUndefined();

        expect(prisma.grant.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.authzProjectionCursor.upsert).toHaveBeenCalledTimes(1);
      });

      /**
       * The collision is a token: some other row already occupies the slot
       * this one wanted. So the compat row for THIS grant may not exist, or
       * may be somebody else's - and every later cleanup has to be keyed by
       * the row id regardless. Keyed by token, a revocation would resolve to
       * whichever row holds the token now: it would delete a link that was
       * never revoked and leave the revoked one resolving.
       */
      it("still cleans up by row id, so the colliding token cannot misdirect a delete", async () => {
        const collided = shareGrantFact({ grantId: "sl_collided" });
        const prisma = makeStorePrisma({
          storedGrants: [collided],
          shareLinkUpsert: vi.fn(async () => {
            throw prismaConflict("P2002");
          }),
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        // The fact arrives, collides on its token, and later departs.
        await repository.store(
          storedProjection({ grants: [collided] }),
          CONTEXT,
        );
        await repository.store(storedProjection(), CONTEXT);
        await repository.enforceGrantRevocation({
          organizationId: ORG,
          grantIds: ["sl_collided"],
        });

        for (const call of vi.mocked(prisma.shareLink.deleteMany).mock.calls) {
          expect(call[0]).toEqual({
            where: {
              projectId: { in: ["proj_chatbot"] },
              id: { in: ["sl_collided"] },
            },
          });
        }
        expect(
          JSON.stringify(vi.mocked(prisma.shareLink.deleteMany).mock.calls),
        ).not.toContain("tok_");
      });
    });

    describe("when the custom-role upsert raises a name collision", () => {
      it("still lands the future head and still advances the cursor", async () => {
        const prisma = makeStorePrisma({
          customRoleUpsert: vi.fn(async () => {
            throw prismaConflict("P2002");
          }),
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await expect(
          repository.store(storedProjection({ roles: [roleFact()] }), CONTEXT),
        ).resolves.toBeUndefined();

        expect(prisma.role.upsert).toHaveBeenCalledTimes(1);
        expect(prisma.authzProjectionCursor.upsert).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the failure is not a conflict", () => {
      it("throws, because an unexplained write failure must not be swallowed", async () => {
        const prisma = makeStorePrisma({
          roleBindingUpsert: vi.fn(async () => {
            throw new Error("connection reset");
          }),
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await expect(
          repository.store(
            storedProjection({ grants: [grantFact()] }),
            CONTEXT,
          ),
        ).rejects.toThrow("connection reset");
        expect(prisma.authzProjectionCursor.upsert).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * The state table is written BOTH synchronously by the runner (its
   * finalized latch must never wait on a queue) and by this fold. The guard
   * below is the only thing stopping a lagging fold from regressing a newer
   * direct write, so its shape is worth pinning.
   */
  describe("given a folded migration transition", () => {
    describe("when the row is at least as old as the transition", () => {
      it("updates it under a guard bounded by the transition's own business time", async () => {
        const prisma = makeStorePrisma({
          migrationUpdateCount: 1,
          storedMigrations: [
            {
              migrationName: "authz-team-user-backfill",
              status: "migrated",
              occurredAt: new Date(STAMP),
            },
          ],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({
            migrationStates: {
              "authz-team-user-backfill": {
                status: "finalized",
                occurredAtMs: 1_700_000_500_000,
              },
            },
          }),
          CONTEXT,
        );

        expect(
          prisma.systemMigrationTenantState.updateMany,
        ).toHaveBeenCalledWith({
          where: {
            migrationName: "authz-team-user-backfill",
            tenantId: ORG,
            // Business time, not the row's wall clock: `updatedAt` moves for
            // reasons that are not transitions.
            occurredAt: { lte: new Date(1_700_000_500_000) },
          },
          data: {
            status: "finalized",
            report: expect.anything(),
            occurredAt: new Date(1_700_000_500_000),
          },
        });
        // The guard matched, so nothing is created behind it.
        expect(
          prisma.systemMigrationTenantState.createMany,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when the guard matches nothing", () => {
      it("creates the row race-safely, stamped with the transition's own time", async () => {
        // Zero affected rows means the row does not exist yet (replay onto
        // an empty table), or a newer direct write landed since the read.
        // `skipDuplicates` is what keeps the second case safe - and stamping
        // `occurredAt` from the fact is what lets the NEXT fact in the same
        // replay pass the guard, instead of the table converging to the
        // oldest status in the stream.
        const prisma = makeStorePrisma({ migrationUpdateCount: 0 });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({
            migrationStates: {
              "authz-team-user-backfill": {
                status: "parked",
                occurredAtMs: 1_700_000_100_000,
              },
            },
          }),
          CONTEXT,
        );

        expect(
          prisma.systemMigrationTenantState.createMany,
        ).toHaveBeenCalledWith({
          data: [
            {
              migrationName: "authz-team-user-backfill",
              tenantId: ORG,
              status: "parked",
              report: expect.anything(),
              occurredAt: new Date(1_700_000_100_000),
            },
          ],
          skipDuplicates: true,
        });
      });
    });

    describe("when a newer direct write already holds the row", () => {
      it("leaves it alone rather than issuing a write the guard would refuse", async () => {
        const prisma = makeStorePrisma({
          storedMigrations: [
            {
              migrationName: "authz-team-user-backfill",
              status: "finalized",
              occurredAt: new Date(1_700_000_900_000),
            },
          ],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({
            migrationStates: {
              "authz-team-user-backfill": {
                status: "migrated",
                occurredAtMs: 1_700_000_100_000,
              },
            },
          }),
          CONTEXT,
        );

        expect(
          prisma.systemMigrationTenantState.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prisma.systemMigrationTenantState.createMany,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when the row already holds exactly this transition", () => {
      it("does not touch it, so the ops page's last-transitioned stays true", async () => {
        const prisma = makeStorePrisma({
          storedMigrations: [
            {
              migrationName: "authz-team-user-backfill",
              status: "finalized",
              occurredAt: new Date(1_700_000_100_000),
            },
          ],
        });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(
          storedProjection({
            migrationStates: {
              "authz-team-user-backfill": {
                status: "finalized",
                occurredAtMs: 1_700_000_100_000,
              },
            },
          }),
          CONTEXT,
        );

        expect(
          prisma.systemMigrationTenantState.updateMany,
        ).not.toHaveBeenCalled();
      });
    });

    describe("when there are no transitions to write", () => {
      it("leaves the state table alone", async () => {
        const prisma = makeStorePrisma({ migrationUpdateCount: 0 });
        const repository = new PrismaAuthzGrantsProjectionRepository(prisma);

        await repository.store(storedProjection(), CONTEXT);

        expect(
          prisma.systemMigrationTenantState.updateMany,
        ).not.toHaveBeenCalled();
        expect(
          prisma.systemMigrationTenantState.createMany,
        ).not.toHaveBeenCalled();
      });
    });
  });
});
