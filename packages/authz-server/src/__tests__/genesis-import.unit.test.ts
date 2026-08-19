import { beforeEach, describe, expect, it } from "vitest";
import type {
  AuthzGenesisRepository,
  LegacyBindingRow,
  LegacyRoleRow,
  OrganizationMemberFact,
  RoleHeadRow,
} from "../authz-migration.repository";
import {
  type GenesisDiff,
  GrantsGenesisImportMigration,
} from "../genesis-import.migration";
import type {
  BackfillGrantEmission,
  GrantsLedgerEmitter,
} from "../team-user-backfill.migration";
import type { RoleFact } from "../ledger/grants-ledger.reducer";

const ORG = "org_acme";
const ORG_CREATED_AT_MS = 1_600_000_000_000;
const ROW_CREATED_AT_MS = 1_700_000_000_000;

/**
 * The heads as the fold would leave them: an attach lands its grant id, a
 * role definition lands its role head. The legacy binding rows are the
 * compat view - and the genesis source never authors a NEW one, so this
 * fake leaves them exactly as they were unless a test says otherwise.
 */
class FakeGenesisRepository implements AuthzGenesisRepository {
  organizationCreatedAtMs: number | null = ORG_CREATED_AT_MS;
  bindingRows: LegacyBindingRow[] = [];
  roleRows: LegacyRoleRow[] = [];
  members: OrganizationMemberFact[] = [];
  grantHeadIds: string[] = [];
  roleHeads: RoleHeadRow[] = [];
  /** What the proof's re-read sees, when a test wants the compat view to
   *  have moved under it. Reads see `bindingRows` until the fake ledger
   *  lands the import. */
  bindingRowsAfterImport: LegacyBindingRow[] | null = null;
  /** Flipped by the fake ledger when the import's grants land, so the
   *  proof's re-read is keyed on WHEN it happens rather than on how many
   *  reads preceded it. */
  importHasLanded = false;

  async findOrganizationCreatedAtMs(): Promise<number | null> {
    return this.organizationCreatedAtMs;
  }
  async findLegacyBindingRows(): Promise<LegacyBindingRow[]> {
    if (!this.importHasLanded) return this.bindingRows;
    return this.bindingRowsAfterImport ?? this.bindingRows;
  }
  async findLegacyRoleRows(): Promise<LegacyRoleRow[]> {
    return this.roleRows;
  }
  async findOrganizationMembers(): Promise<OrganizationMemberFact[]> {
    return this.members;
  }
  async findGrantHeadIds(): Promise<string[]> {
    return this.grantHeadIds;
  }
  /** The fake's whole head is genesis-owned - every test that wants a
   *  non-genesis-sourced fact standing in the head does so explicitly by
   *  pushing straight onto `grantHeadIds` outside a ledger call, and such a
   *  test must override this method itself. None currently need to. */
  async findGenesisOwnedGrantHeadIds(): Promise<string[]> {
    return this.grantHeadIds;
  }
  async findRoleHeads(): Promise<RoleHeadRow[]> {
    return this.roleHeads;
  }
}

/** The ledger as the import sees it, converging into the fake's heads. */
class FakeLedger implements GrantsLedgerEmitter {
  calls: Array<
    | { verb: "defineRoles"; commandId: string; roles: RoleFact[] }
    | { verb: "attachGrants"; commandId: string; grants: BackfillGrantEmission[] }
    | {
        verb: "revokeGrants";
        commandId: string;
        revocations: Array<{ grantId: string; reason?: string }>;
      }
    | { verb: "deleteRole"; commandId: string; roleId: string }
  > = [];
  /** Flip off to simulate a fold that never runs. */
  projectionConverges = true;
  /** How a defined role lands in the head; a test overrides it to simulate
   *  a head that does not reproduce its legacy row. */
  landRoleHead: (role: RoleFact) => RoleHeadRow = (role) => ({
    id: role.roleId,
    name: role.name,
    description: role.description ?? null,
    permissions: role.permissions,
    kind: role.kind,
  });

  constructor(private readonly repository: FakeGenesisRepository) {}

  async attachGrants({
    commandId,
    grants,
  }: {
    organizationId: string;
    commandId: string;
    grants: BackfillGrantEmission[];
  }): Promise<void> {
    this.calls.push({ verb: "attachGrants", commandId, grants });
    if (!this.projectionConverges) return;
    this.repository.importHasLanded = true;
    this.repository.grantHeadIds.push(...grants.map((g) => g.grantId));
  }

  async defineRoles({
    commandId,
    roles,
  }: {
    organizationId: string;
    commandId: string;
    roles: RoleFact[];
    actor: { type: "user" | "system"; id: string | null };
  }): Promise<void> {
    this.calls.push({ verb: "defineRoles", commandId, roles });
    if (!this.projectionConverges) return;
    this.repository.roleHeads.push(...roles.map(this.landRoleHead));
  }

  async revokeGrants({
    commandId,
    revocations,
  }: {
    organizationId: string;
    commandId: string;
    revocations: Array<{ grantId: string; reason?: string }>;
    actor: { type: "user" | "system"; id: string | null };
    occurredAtMs: number;
  }): Promise<void> {
    this.calls.push({ verb: "revokeGrants", commandId, revocations });
    if (!this.projectionConverges) return;
    const revoked = new Set(revocations.map((r) => r.grantId));
    this.repository.grantHeadIds = this.repository.grantHeadIds.filter(
      (id) => !revoked.has(id),
    );
  }

  async deleteRole({
    commandId,
    roleId,
  }: {
    organizationId: string;
    commandId: string;
    roleId: string;
    actor: { type: "user" | "system"; id: string | null };
    occurredAtMs: number;
  }): Promise<void> {
    this.calls.push({ verb: "deleteRole", commandId, roleId });
    if (!this.projectionConverges) return;
    this.repository.roleHeads = this.repository.roleHeads.filter(
      (head) => head.id !== roleId,
    );
  }

  async proveMigrationParity(): Promise<void> {
    throw new Error("the genesis import proves nothing to the ledger");
  }
}

function bindingRow(overrides: Partial<LegacyBindingRow> = {}): LegacyBindingRow {
  return {
    id: "rb_1",
    userId: "user_sam",
    groupId: null,
    apiKeyId: null,
    role: "MEMBER",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: "team_support",
    createdAtMs: ROW_CREATED_AT_MS,
    ...overrides,
  };
}

describe("GrantsGenesisImportMigration", () => {
  let repository: FakeGenesisRepository;
  let ledger: FakeLedger;

  const migration = () =>
    new GrantsGenesisImportMigration({
      repository,
      ledger,
      now: () => Date.now(),
      poll: { intervalMs: 1, timeoutMs: 50 },
    });

  const attachedGrants = () =>
    ledger.calls.flatMap((call) =>
      call.verb === "attachGrants" ? call.grants : [],
    );

  beforeEach(() => {
    repository = new FakeGenesisRepository();
    ledger = new FakeLedger(repository);
  });

  describe("given legacy bindings and custom roles", () => {
    beforeEach(() => {
      repository.roleRows = [
        {
          id: "cr_1",
          name: "Analyst",
          description: null,
          permissions: ["traces.read", 42],
          kind: "custom",
          createdAtMs: ROW_CREATED_AT_MS,
        },
      ];
      repository.bindingRows = [
        bindingRow({ id: "rb_1" }),
        bindingRow({
          id: "rb_2",
          userId: "user_robin",
          role: "CUSTOM",
          customRoleId: "cr_1",
          scopeType: "PROJECT",
          scopeId: "proj_chatbot",
        }),
      ];
    });

    describe("when the import runs", () => {
      /** @scenario "Existing grants become ledger facts under the ids they already have" */
      it("adopts every legacy id verbatim as the ledger's own", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        const roleCall = ledger.calls.find((c) => c.verb === "defineRoles");
        expect(roleCall).toMatchObject({
          roles: [
            {
              // The CustomRole row's id IS the role id - adoption, not a
              // re-creation under a fresh identity.
              roleId: "cr_1",
              name: "Analyst",
              // Non-string entries cannot be registry permissions.
              permissions: ["traces.read"],
              kind: "custom",
              occurredAtMs: ROW_CREATED_AT_MS,
            },
          ],
        });
        expect(roleCall).not.toHaveProperty("roles.0.description");

        const bindingGrants = attachedGrants().filter((grant) =>
          ["rb_1", "rb_2"].includes(grant.grantId),
        );
        expect(bindingGrants).toEqual([
          expect.objectContaining({
            // The RoleBinding row's own id: the identity customers already
            // hold survives the whole migration.
            grantId: "rb_1",
            principal: { type: "user", id: "user_sam" },
            roleKey: "member",
            scope: { type: "TEAM", id: "team_support" },
            source: "genesis-import",
            occurredAtMs: ROW_CREATED_AT_MS,
            actor: { type: "system", id: "system:genesis-import" },
          }),
          expect.objectContaining({
            grantId: "rb_2",
            principal: { type: "user", id: "user_robin" },
            // The custom role IS the row's identity, so it rides in the key —
            // and the row's role column travels as legacyRole so the compat
            // upsert reproduces it instead of rewriting it to CUSTOM.
            roleKey: "custom:cr_1",
            legacyRole: "CUSTOM",
            scope: { type: "PROJECT", id: "proj_chatbot" },
          }),
        ]);
      });

      it("defines every role before attaching the grants that name them", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        const verbs = ledger.calls.map((call) => call.verb);
        expect(verbs.indexOf("defineRoles")).toBeLessThan(
          verbs.indexOf("attachGrants"),
        );
      });

      it("names each chunk from its own content so a retry appends the same events", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        const firstPass = ledger.calls.map((call) => call.commandId);

        repository.importHasLanded = false;
        repository.grantHeadIds = [];
        repository.roleHeads = [];
        ledger.calls = [];
        await migration().migrateTenant({ tenantId: ORG });

        expect(ledger.calls.map((call) => call.commandId)).toEqual(firstPass);
        for (const commandId of firstPass) {
          expect(commandId).toMatch(/^genesis:(roles|grants|org-facts):org_acme:[0-9a-f]{16}$/);
        }
      });

      /** @scenario "The import proves itself against the rows it started from" */
      it("finalizes when every original row is still there, field for field", async () => {
        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("finalized");
        expect(outcome.report).toMatchObject({
          kind: "genesis_clean",
          bindings: 2,
          roles: 1,
          orgFacts: 1,
        });
      });
    });

    describe("when the projection rewrites a custom row's role column", () => {
      it("holds the organization - the emission carries legacyRole so the column must survive", async () => {
        // rb_2 arrives as (MEMBER, cr_1). The emission carries the row's
        // role as `legacyRole` and the compat upsert reproduces it, so a
        // fold that rewrites the column to CUSTOM is drift like any other:
        // the legacy resolver is still authoritative and the column is
        // what it reads.
        repository.bindingRows = repository.bindingRows.map((row) =>
          row.id === "rb_2" ? { ...row, role: "MEMBER" as const } : row,
        );
        repository.bindingRowsAfterImport = repository.bindingRows.map((row) =>
          row.id === "rb_2" ? { ...row, role: "CUSTOM" as const } : row,
        );

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        expect(outcome.report).toMatchObject({
          kind: "genesis_drift",
          diffs: [
            {
              kind: "binding_changed",
              id: "rb_2",
              field: "role",
              expected: "MEMBER",
              actual: "CUSTOM",
            },
          ],
        });
      });
    });

    describe("when the compat view no longer reproduces a legacy row", () => {
      /** @scenario "A compat view that no longer reproduces a legacy row holds the organization" */
      it("holds the organization with the drift in a bounded report", async () => {
        // The proof's re-read is what it compares against: one row moved
        // scope, the other gone.
        repository.bindingRowsAfterImport = [
          { ...repository.bindingRows[0]!, scopeId: "team_elsewhere" },
        ];

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        const report = outcome.report as {
          kind: string;
          totalDiffs: number;
          diffs: GenesisDiff[];
        };
        expect(report.kind).toBe("genesis_drift");
        expect(report.totalDiffs).toBe(2);
        expect(report.diffs).toEqual([
          {
            kind: "binding_changed",
            id: "rb_1",
            field: "scopeId",
            expected: "team_support",
            actual: "team_elsewhere",
          },
          { kind: "binding_missing", id: "rb_2" },
        ]);
        expect(report.diffs.length).toBeLessThanOrEqual(50);
      });

      it("reports a role head that does not carry its legacy row's fields", async () => {
        ledger.landRoleHead = (role) => ({
          id: role.roleId,
          name: "Renamed",
          description: null,
          permissions: role.permissions,
          kind: role.kind,
        });

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        expect(
          (outcome.report as { diffs: GenesisDiff[] }).diffs,
        ).toContainEqual({
          kind: "role_changed",
          id: "cr_1",
          field: "name",
          expected: "Analyst",
          actual: "Renamed",
        });
      });
    });
  });

  describe("given an organization's membership rows", () => {
    beforeEach(() => {
      repository.members = [
        { userId: "user_sam", role: "ADMIN", createdAtMs: ROW_CREATED_AT_MS },
        { userId: "user_robin", role: "ADMIN", createdAtMs: ROW_CREATED_AT_MS },
        { userId: "user_kim", role: "MEMBER", createdAtMs: ROW_CREATED_AT_MS },
      ];
      // Sam holds a binding somewhere; Robin and Kim hold none.
      repository.bindingRows = [
        bindingRow({ id: "rb_1", userId: "user_sam" }),
      ];
    });

    /** @scenario "The organization member floor becomes a grant the organization holds" */
    it("mints the member floor row once, at the organization's own birth", async () => {
      await migration().migrateTenant({ tenantId: ORG });

      const floor = attachedGrants().filter(
        (grant) => grant.principal.type === "organization",
      );
      expect(floor).toEqual([
        expect.objectContaining({
          principal: { type: "organization", id: ORG },
          roleKey: "member",
          scope: { type: "ORGANIZATION", id: ORG },
          source: "genesis-import",
          occurredAtMs: ORG_CREATED_AT_MS,
        }),
      ]);
    });

    /** @scenario "A legacy organization admin with no bindings states its access" */
    it("mints an admin fact only for an ADMIN the legacy fallback is the sole source for", async () => {
      await migration().migrateTenant({ tenantId: ORG });

      const orgScoped = attachedGrants().filter(
        (grant) =>
          grant.principal.type === "user" &&
          grant.scope.type === "ORGANIZATION",
      );
      expect(orgScoped).toEqual([
        expect.objectContaining({
          principal: { type: "user", id: "user_robin" },
          roleKey: "admin",
          occurredAtMs: ROW_CREATED_AT_MS,
        }),
      ]);
      // Sam's bindings already represent him; Kim is a member, and the
      // floor row covers members.
      expect(
        orgScoped.map((grant) => grant.principal.id),
      ).not.toContain("user_sam");
      expect(
        orgScoped.map((grant) => grant.principal.id),
      ).not.toContain("user_kim");
    });

    /** @scenario "Running the genesis import twice states the same facts" */
    it("emits the same ids on a second pass", async () => {
      await migration().migrateTenant({ tenantId: ORG });
      const first = attachedGrants().map((grant) => grant.grantId);
      ledger.calls = [];

      await migration().migrateTenant({ tenantId: ORG });

      expect(attachedGrants().map((grant) => grant.grantId)).toEqual(first);
    });
  });

  describe("given a retried pass whose legacy rows shifted", () => {
    const rowA = bindingRow({ id: "rb_a", userId: "user_a" });
    const rowB = bindingRow({ id: "rb_b", userId: "user_b" });
    const rowD = bindingRow({ id: "rb_d", userId: "user_d" });
    const rowE = bindingRow({ id: "rb_e", userId: "user_e" });

    /** @scenario "A shifted chunk never reuses a previous pass's idempotency key" */
    it("derives a different commandId when a chunk's content differs at the same position", async () => {
      repository.bindingRows = [rowA, rowB, rowD];
      await migration().migrateTenant({ tenantId: ORG });
      const firstKey = ledger.calls.find(
        (call) =>
          call.verb === "attachGrants" &&
          call.grants.some((grant) => grant.grantId === "rb_a"),
      )?.commandId;

      // rb_b is deleted on the legacy side (imperative row-delete, no
      // event) and rb_e is created there while the organization sits on
      // the legacy path. Both passes still chunk to a single batch at
      // index 0 - a positional key (`genesis:grants:<org>:0`) would be
      // IDENTICAL for both, and the event store dedupes on the
      // idempotencyKey alone, so rb_e's attach would be silently dropped
      // on every retry forever.
      repository.bindingRows = [rowA, rowD, rowE];
      ledger.calls = [];
      await migration().migrateTenant({ tenantId: ORG });
      const secondKey = ledger.calls.find(
        (call) =>
          call.verb === "attachGrants" &&
          call.grants.some((grant) => grant.grantId === "rb_a"),
      )?.commandId;

      expect(secondKey).toBeDefined();
      expect(secondKey).not.toBe(firstKey);
    });

    /** @scenario "The row that replaced a deleted one reaches the fold" */
    it("lands the replacement row's grant instead of it being deduped away", async () => {
      repository.bindingRows = [rowA, rowB, rowD];
      await migration().migrateTenant({ tenantId: ORG });

      repository.bindingRows = [rowA, rowD, rowE];
      await migration().migrateTenant({ tenantId: ORG });

      expect(repository.grantHeadIds).toContain("rb_e");
    });
  });

  describe("given a legacy binding deleted after the import already landed it", () => {
    /** @scenario "A grant revoked on the legacy side does not survive a re-import" */
    it("clears the head fact once the legacy row is gone", async () => {
      repository.bindingRows = [bindingRow({ id: "rb_1" })];
      await migration().migrateTenant({ tenantId: ORG });
      expect(repository.grantHeadIds).toContain("rb_1");

      repository.bindingRows = [];
      await migration().migrateTenant({ tenantId: ORG });

      expect(repository.grantHeadIds).not.toContain("rb_1");
    });

    it("asks the ledger to revoke it, not merely stop re-attaching it", async () => {
      repository.bindingRows = [bindingRow({ id: "rb_1" })];
      await migration().migrateTenant({ tenantId: ORG });

      repository.bindingRows = [];
      ledger.calls = [];
      await migration().migrateTenant({ tenantId: ORG });

      expect(ledger.calls).toContainEqual(
        expect.objectContaining({
          verb: "revokeGrants",
          revocations: [expect.objectContaining({ grantId: "rb_1" })],
        }),
      );
    });
  });

  describe("given a custom role deleted after the import already landed it", () => {
    beforeEach(() => {
      repository.roleRows = [
        {
          id: "cr_1",
          name: "Analyst",
          description: null,
          permissions: ["traces.read"],
          kind: "custom",
          createdAtMs: ROW_CREATED_AT_MS,
        },
      ];
    });

    /** @scenario "A custom role deleted on the legacy side does not survive a re-import" */
    it("clears the role head once the legacy row is gone", async () => {
      await migration().migrateTenant({ tenantId: ORG });
      expect(repository.roleHeads.map((head) => head.id)).toContain("cr_1");

      repository.roleRows = [];
      await migration().migrateTenant({ tenantId: ORG });

      expect(repository.roleHeads.map((head) => head.id)).not.toContain(
        "cr_1",
      );
    });

    it("asks the ledger to delete it, not merely stop redefining it", async () => {
      await migration().migrateTenant({ tenantId: ORG });

      repository.roleRows = [];
      ledger.calls = [];
      await migration().migrateTenant({ tenantId: ORG });

      expect(ledger.calls).toContainEqual(
        expect.objectContaining({ verb: "deleteRole", roleId: "cr_1" }),
      );
    });
  });

  describe("when a compensating revocation never lands", () => {
    it("parks the organization rather than finalizing over a zombie grant", async () => {
      repository.bindingRows = [bindingRow({ id: "rb_1" })];
      await migration().migrateTenant({ tenantId: ORG });

      repository.bindingRows = [];
      ledger.projectionConverges = false;

      await expect(
        migration().migrateTenant({ tenantId: ORG }),
      ).rejects.toThrow(/did not clear/);
    });
  });

  describe("when the fold never lands the import", () => {
    it("parks the organization instead of proving against work in flight", async () => {
      repository.bindingRows = [bindingRow()];
      ledger.projectionConverges = false;

      await expect(
        migration().migrateTenant({ tenantId: ORG }),
      ).rejects.toThrow(/did not land the genesis import/);
    });
  });

  describe("when the pass is aborted part-way through", () => {
    it("throws rather than proving an import it never finished emitting", async () => {
      repository.bindingRows = [bindingRow()];
      const controller = new AbortController();
      controller.abort();

      await expect(
        migration().migrateTenant({
          tenantId: ORG,
          signal: controller.signal,
        }),
      ).rejects.toThrow(/aborted/);
      expect(ledger.calls).toHaveLength(0);
    });
  });
});
