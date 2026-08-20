import type { CollectedGrants } from "@langwatch/authz";
import type { TenantMigrationStatus } from "@langwatch/system-migrations";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthzCollectorService } from "../authz-collector.service";
import type {
  AuthzCutoverRepository,
  ExternalMemberFact,
  OrganizationScopeInventory,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  ShareLinkFactRow,
} from "../authz-migration.repository";
import {
  type CutoverResourceDiff,
  GrantsCutoverMigration,
  parityCommandId,
} from "../cutover.migration";
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "../genesis-import.name";
import {
  emptyGrantsLedgerState,
  type GrantsLedgerActor,
  type GrantsLedgerState,
  reduceGrantsLedger,
} from "../ledger/grants-ledger.reducer";
import type {
  BackfillGrantEmission,
  GrantsLedgerEmitter,
} from "../team-user-backfill.migration";
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "../team-user-backfill.name";

const ORG = "org_acme";
const SHARE_CREATED_AT_MS = 1_700_000_000_000;
const MEMBER_CREATED_AT_MS = 1_690_000_000_000;
const PROJECT_CREATED_AT_MS = 1_680_000_000_000;

/**
 * The heads as the fold would leave them: an attach lands its grant id on
 * the aggregate it was sent to, and the RESOURCE rows reproduce what the
 * emission said. Both are what the migration's two proofs re-read.
 */
class FakeCutoverRepository implements AuthzCutoverRepository {
  prerequisiteStatuses: Record<string, TenantMigrationStatus | null> = {
    [TEAM_USER_BACKFILL_MIGRATION_NAME]: "finalized",
    [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: "finalized",
  };
  shareLinkRows: ShareLinkFactRow[] = [];
  externalMembers: ExternalMemberFact[] = [];
  projectCredentials: ProjectCredentialFact[] = [];
  memberIds: string[] = [];
  apiKeyIds: string[] = [];
  inventory: OrganizationScopeInventory = { teamIds: [], projects: [] };
  /** Grant head ids per aggregate. */
  grantHeadIds = new Map<string, string[]>();
  /** What the resource proof's re-read sees; null means "derive it from
   *  what the ledger landed", which is the converged case. */
  resourceGrantRows: ResourceGrantRow[] | null = null;
  landedResourceRows: ResourceGrantRow[] = [];
  onEngine = false;
  /** Flip on to have the projection never report the flip. */
  cutoverNeverLands = false;
  /** The usage rows the seed wrote, keyed by grant id - created when
   *  absent, RAISED when the seeded count is higher, never lowered,
   *  exactly as the Prisma implementation behaves (the port's monotonic
   *  contract). */
  usageRows = new Map<string, number>();
  seedCalls: ResourceGrantUsageSeed[][] = [];

  async findMigrationTenantStatuses({
    migrationNames,
  }: {
    tenantId: string;
    migrationNames: readonly string[];
  }): Promise<Record<string, TenantMigrationStatus | null>> {
    return Object.fromEntries(
      migrationNames.map((name) => [
        name,
        this.prerequisiteStatuses[name] ?? null,
      ]),
    );
  }
  async findShareLinkRows(): Promise<ShareLinkFactRow[]> {
    return this.shareLinkRows;
  }
  async findExternalMemberFacts(): Promise<ExternalMemberFact[]> {
    return this.externalMembers;
  }
  async findProjectCredentialFacts(): Promise<ProjectCredentialFact[]> {
    return this.projectCredentials;
  }
  async findResourceGrantRows(): Promise<ResourceGrantRow[]> {
    // An explicit list IS what the head says, drift and all. Otherwise the
    // rows are derived from what the ledger landed, joined to the usage
    // table the way the Prisma repository joins it.
    if (this.resourceGrantRows) return this.resourceGrantRows;
    return this.landedResourceRows.map((row) => ({
      ...row,
      viewCount: this.usageRows.get(row.grantId) ?? 0,
    }));
  }
  async seedResourceGrantUsage({
    seeds,
  }: {
    organizationId: string;
    seeds: readonly ResourceGrantUsageSeed[];
  }): Promise<void> {
    this.seedCalls.push([...seeds]);
    for (const seed of seeds) {
      const stored = this.usageRows.get(seed.grantId);
      if (stored !== undefined && stored >= seed.viewCount) continue;
      this.usageRows.set(seed.grantId, seed.viewCount);
    }
  }
  async findOrganizationScopeInventory(): Promise<OrganizationScopeInventory> {
    return this.inventory;
  }
  async findOrganizationMemberIds(): Promise<string[]> {
    return this.memberIds;
  }
  async findOrganizationApiKeyIds(): Promise<string[]> {
    return this.apiKeyIds;
  }
  async findGrantHeadIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    return this.grantHeadIds.get(organizationId) ?? [];
  }
  async findCutoverOnEngine(): Promise<boolean> {
    return this.onEngine;
  }
}

type LedgerCall =
  | {
      verb: "attachGrants";
      organizationId: string;
      commandId: string;
      grants: BackfillGrantEmission[];
    }
  | {
      verb: "proveMigrationParity";
      commandId: string;
      diffs: string[];
      occurredAtMs: number;
    }
  | {
      verb: "completeCutover";
      organizationId: string;
      commandId: string;
      actor: GrantsLedgerActor;
      occurredAtMs: number;
    };

/** The ledger as the cutover sees it, converging into the fake's heads. */
class FakeLedger implements GrantsLedgerEmitter {
  calls: LedgerCall[] = [];
  /** Flip off to simulate a fold that never runs. */
  projectionConverges = true;

  constructor(private readonly repository: FakeCutoverRepository) {}

  async attachGrants({
    organizationId,
    commandId,
    grants,
  }: {
    organizationId: string;
    commandId: string;
    grants: BackfillGrantEmission[];
  }): Promise<void> {
    this.calls.push({ verb: "attachGrants", organizationId, commandId, grants });
    if (!this.projectionConverges) return;
    const heads = this.repository.grantHeadIds.get(organizationId) ?? [];
    heads.push(...grants.map((grant) => grant.grantId));
    this.repository.grantHeadIds.set(organizationId, heads);
    this.repository.landedResourceRows.push(
      ...grants.flatMap((grant) =>
        grant.resource === undefined
          ? []
          : [
              {
                grantId: grant.grantId,
                token: grant.resource.token,
                resourceKind: grant.resource.kind.toUpperCase(),
                resourceId: grant.scope.id,
                projectId: grant.resource.projectId,
                principalType: grant.principal.type.toUpperCase(),
                principalId: grant.principal.id,
                expiresAtMs: grant.resource.expiresAtMs ?? null,
                maxViews: grant.resource.maxViews ?? null,
                viewCount: 0,
              },
            ],
      ),
    );
  }

  async defineRoles(): Promise<void> {
    throw new Error("the cutover defines no roles");
  }

  // The deny direction belongs to the genesis import, never to the cutover -
  // so reaching either of these from here is the failure, not the fallback.
  async revokeGrants(): Promise<void> {
    throw new Error("the cutover revokes nothing");
  }

  async deleteRole(): Promise<void> {
    throw new Error("the cutover deletes no roles");
  }

  async proveMigrationParity({
    commandId,
    diffs,
    occurredAtMs,
  }: {
    organizationId: string;
    commandId: string;
    diffs: string[];
    occurredAtMs: number;
  }): Promise<void> {
    this.calls.push({
      verb: "proveMigrationParity",
      commandId,
      diffs,
      occurredAtMs,
    });
  }

  async completeCutover({
    organizationId,
    commandId,
    actor,
    occurredAtMs,
  }: {
    organizationId: string;
    commandId: string;
    actor: GrantsLedgerActor;
    occurredAtMs: number;
  }): Promise<void> {
    this.calls.push({
      verb: "completeCutover",
      organizationId,
      commandId,
      actor,
      occurredAtMs,
    });
    if (!this.repository.cutoverNeverLands) this.repository.onEngine = true;
  }
}

function emptyGrants({
  principal,
}: {
  principal: CollectedGrants["principal"];
}): CollectedGrants {
  return {
    principal,
    organizationId: ORG,
    organizationRole: null,
    isOrgMember: false,
    bindings: [],
    legacyTeamMemberships: [],
    customRolePermissions: new Map(),
  };
}

/** A collector stub: the proof only ever asks it these two questions. */
function collectorOf({
  grantsFor = () => null,
  owner = null,
}: {
  grantsFor?: (principalId: string) => CollectedGrants | null;
  owner?: { userId: string | null } | null;
} = {}): AuthzCollectorService {
  return {
    collectGrants: async ({
      principal,
    }: {
      principal: CollectedGrants["principal"];
      organizationId: string;
    }) =>
      (principal.type === "anonymous" ? null : grantsFor(principal.id)) ??
      emptyGrants({ principal }),
    findApiKeyOwner: async () => owner,
  } as unknown as AuthzCollectorService;
}

function shareLinkRow(
  overrides: Partial<ShareLinkFactRow> = {},
): ShareLinkFactRow {
  return {
    id: "share_1",
    token: "tok_abc",
    resourceType: "TRACE",
    resourceId: "trace_1",
    projectId: "proj_chatbot",
    userId: "user_sam",
    visibility: "PUBLIC",
    expiresAtMs: null,
    maxViews: null,
    viewCount: 0,
    createdAtMs: SHARE_CREATED_AT_MS,
    ...overrides,
  };
}

describe("GrantsCutoverMigration", () => {
  let repository: FakeCutoverRepository;
  let ledger: FakeLedger;
  let cohort: boolean;
  /** A clock that only ever moves forward, so two passes in the same
   *  millisecond are still two passes. */
  let clock: number;

  const migration = () =>
    new GrantsCutoverMigration({
      repository,
      ledger,
      collectors: { legacy: collectorOf(), grants: collectorOf() },
      cutoverCohort: () => cohort,
      now: () => clock++,
      poll: { intervalMs: 1, timeoutMs: 50 },
    });

  const attached = () =>
    ledger.calls.flatMap((call) =>
      call.verb === "attachGrants" ? call.grants : [],
    );

  beforeEach(() => {
    repository = new FakeCutoverRepository();
    ledger = new FakeLedger(repository);
    cohort = true;
    clock = 1_700_000_000_000;
  });

  describe("given an organization whose earlier migrations have not finished", () => {
    describe("when the cutover runs", () => {
      /** @scenario "An organization enrolled only for a later migration waits on its prerequisites" */
      it("holds it, naming what it is waiting for, and emits nothing", async () => {
        repository.prerequisiteStatuses = {
          [TEAM_USER_BACKFILL_MIGRATION_NAME]: "finalized",
          [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: "migrated",
        };

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        expect(outcome.report).toEqual({
          kind: "cutover_waiting",
          awaiting: [GRANTS_GENESIS_IMPORT_MIGRATION_NAME],
        });
        expect(ledger.calls).toEqual([]);
      });

      it("waits on a migration that never ran at all", async () => {
        repository.prerequisiteStatuses = {};

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.report).toMatchObject({
          awaiting: [
            TEAM_USER_BACKFILL_MIGRATION_NAME,
            GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
          ],
        });
      });
    });
  });

  describe("given an organization outside the cutover cohort", () => {
    it("holds it without importing anything", async () => {
      cohort = false;
      repository.shareLinkRows = [shareLinkRow()];

      const outcome = await migration().migrateTenant({ tenantId: ORG });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toEqual({ kind: "cutover_waiting_cohort" });
      expect(ledger.calls).toEqual([]);
    });
  });

  describe("given the legacy facts that live outside bindings", () => {
    beforeEach(() => {
      repository.shareLinkRows = [
        shareLinkRow({ id: "share_1", visibility: "PUBLIC" }),
        shareLinkRow({
          id: "share_2",
          token: "tok_def",
          resourceType: "THREAD",
          resourceId: "thread_9",
          visibility: "ORGANIZATION",
          expiresAtMs: SHARE_CREATED_AT_MS + 86_400_000,
          maxViews: 5,
          userId: null,
        }),
        shareLinkRow({
          id: "share_3",
          token: "tok_ghi",
          visibility: "PROJECT",
          projectId: "proj_agents",
        }),
      ];
      repository.externalMembers = [
        { userId: "user_ext", createdAtMs: MEMBER_CREATED_AT_MS },
      ];
      repository.projectCredentials = [
        { projectId: "proj_chatbot", createdAtMs: PROJECT_CREATED_AT_MS },
      ];
    });

    describe("when the cutover runs", () => {
      /** @scenario "Cutover imports the legacy facts that only exist outside bindings" */
      it("adopts each share link's own id and states its terms", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        const links = attached().filter(
          (grant) => grant.scope.type === "RESOURCE",
        );
        expect(links).toEqual([
          expect.objectContaining({
            grantId: "share_1",
            principal: { type: "anyone", id: null },
            roleKey: null,
            scope: { type: "RESOURCE", id: "trace_1" },
            source: "cutover-import",
            occurredAtMs: SHARE_CREATED_AT_MS,
            actor: { type: "system", id: "system:grants-cutover" },
            resource: {
              kind: "trace",
              projectId: "proj_chatbot",
              token: "tok_abc",
              permission: "traces:view",
              createdByUserId: "user_sam",
            },
          }),
          expect.objectContaining({
            grantId: "share_2",
            principal: { type: "organization", id: ORG },
            resource: {
              kind: "thread",
              projectId: "proj_chatbot",
              token: "tok_def",
              permission: "traces:view",
              expiresAtMs: SHARE_CREATED_AT_MS + 86_400_000,
              maxViews: 5,
            },
          }),
          expect.objectContaining({
            grantId: "share_3",
            principal: { type: "project", id: "proj_agents" },
          }),
        ]);
      });

      it("states an EXTERNAL membership as a lite-member grant at its own business time", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        expect(
          attached().filter((grant) => grant.roleKey === "lite-member"),
        ).toEqual([
          expect.objectContaining({
            principal: { type: "user", id: "user_ext" },
            roleKey: "lite-member",
            scope: { type: "ORGANIZATION", id: ORG },
            source: "cutover-import",
            occurredAtMs: MEMBER_CREATED_AT_MS,
          }),
        ]);
      });

      it("states a project's legacy credential with the project itself as principal", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        expect(
          attached().filter((grant) => grant.scope.type === "PROJECT"),
        ).toEqual([
          expect.objectContaining({
            principal: { type: "project", id: "proj_chatbot" },
            roleKey: "admin",
            scope: { type: "PROJECT", id: "proj_chatbot" },
            occurredAtMs: PROJECT_CREATED_AT_MS,
          }),
        ]);
      });

      /** @scenario "Platform operator access is never a ledger fact" */
      it("states every fact on the organization's own aggregate and none elsewhere", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        const tenants = new Set(
          ledger.calls
            .filter((call) => call.verb === "attachGrants")
            .map((call) => call.organizationId),
        );
        expect(tenants).toEqual(new Set([ORG]));
      });

      it("names every chunk deterministically so a retry appends the same events", async () => {
        await migration().migrateTenant({ tenantId: ORG });

        // Every family carries a content hash: the source tables are live,
        // and an id keyed on the chunk index alone deduped a SHIFTED chunk
        // against the previous pass's event - the changed fact never landed
        // and convergence waited on it forever.
        expect(
          ledger.calls
            .filter((call) => call.verb === "attachGrants")
            .map((call) => call.commandId),
        ).toEqual([
          expect.stringMatching(
            new RegExp(`^cutover:share-links:${ORG}:[^:]+:0$`),
          ),
          expect.stringMatching(
            new RegExp(`^cutover:lite-members:${ORG}:[^:]+:0$`),
          ),
          expect.stringMatching(
            new RegExp(`^cutover:project-keys:${ORG}:[^:]+:0$`),
          ),
        ]);
      });

      /** @scenario "A shifted chunk never reuses a previous pass's idempotency key" */
      it("names a changed member set differently, so a held organization's new fact still lands", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        const before = ledger.calls
          .filter((call) => call.verb === "attachGrants")
          .map((call) => call.commandId);
        ledger.calls = [];
        // A member joins while the organization is held: the lite-member
        // chunk's contents shift, and its command must not dedupe against
        // the old event.
        repository.externalMembers = [
          ...repository.externalMembers,
          { userId: "user_new", createdAtMs: MEMBER_CREATED_AT_MS + 1 },
        ];

        await migration().migrateTenant({ tenantId: ORG });

        const after = ledger.calls
          .filter((call) => call.verb === "attachGrants")
          .map((call) => call.commandId);
        const liteBefore = before.find((id) =>
          id.startsWith(`cutover:lite-members:${ORG}:`),
        );
        const liteAfter = after.find((id) =>
          id.startsWith(`cutover:lite-members:${ORG}:`),
        );
        expect(liteAfter).not.toBe(liteBefore);
        // The unchanged families still dedupe against their own events.
        expect(
          after.find((id) => id.startsWith(`cutover:share-links:${ORG}:`)),
        ).toBe(before.find((id) => id.startsWith(`cutover:share-links:${ORG}:`)));
      });

      it("emits identical ids and commands on a second pass", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        const first = ledger.calls.filter((call) => call.verb === "attachGrants");
        ledger.calls = [];

        await migration().migrateTenant({ tenantId: ORG });

        expect(
          ledger.calls.filter((call) => call.verb === "attachGrants"),
        ).toEqual(first);
      });

      it("finalizes with the counts it imported", async () => {
        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("finalized");
        expect(outcome.report).toMatchObject({
          kind: "cutover_clean",
          shareLinks: 3,
          liteMembers: 1,
          projectCredentials: 1,
        });
      });
    });

    describe("when the fold never lands the import", () => {
      it("parks the organization rather than proving anything", async () => {
        ledger.projectionConverges = false;

        await expect(
          migration().migrateTenant({ tenantId: ORG }),
        ).rejects.toThrow(/did not land the cutover import/);
      });
    });

    describe("when the pass is aborted between chunks", () => {
      it("parks the organization, leaving the appended events durable", async () => {
        const signal = AbortSignal.abort();

        await expect(
          migration().migrateTenant({ tenantId: ORG, signal }),
        ).rejects.toThrow(/aborted/);
        expect(ledger.calls).toEqual([]);
      });
    });
  });

  describe("given a share link the projection did not reproduce", () => {
    beforeEach(() => {
      repository.shareLinkRows = [shareLinkRow({ maxViews: 3 })];
    });

    describe("when the import proof sweeps", () => {
      it("holds the organization with the drift in a bounded report", async () => {
        repository.resourceGrantRows = [
          {
            grantId: "share_1",
            token: "tok_abc",
            resourceKind: "THREAD",
            resourceId: "trace_1",
            projectId: "proj_chatbot",
            principalType: "ANYONE",
            principalId: null,
            expiresAtMs: null,
            maxViews: null,
            viewCount: 0,
          },
        ];

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        const report = outcome.report as {
          kind: string;
          totalDiffs: number;
          diffs: CutoverResourceDiff[];
        };
        expect(report.kind).toBe("cutover_resource_drift");
        expect(report.totalDiffs).toBe(2);
        expect(report.diffs).toEqual([
          {
            kind: "resource_changed",
            id: "share_1",
            field: "kind",
            expected: "TRACE",
            actual: "THREAD",
          },
          {
            kind: "resource_changed",
            id: "share_1",
            field: "maxViews",
            expected: "3",
            actual: null,
          },
        ]);
        expect(
          ledger.calls.some((call) => call.verb === "completeCutover"),
        ).toBe(false);
      });

      it("reports a link with no grant row at all as missing", async () => {
        repository.resourceGrantRows = [];

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect((outcome.report as { diffs: CutoverResourceDiff[] }).diffs).toEqual(
          [{ kind: "resource_missing", id: "share_1" }],
        );
      });

      /**
       * The other direction, and the dangerous one: a missing grant DROPS
       * access, an extra grant INVENTS it - a link nobody minted, resolving
       * for whoever holds its token. Sweeping only the legacy rows cannot see
       * it, so this is the case that proves the sweep looks both ways.
       */
      /** @scenario "A share grant no legacy link accounts for holds the cutover" */
      it("reports a grant row no share link accounts for as extra", async () => {
        // Derived, not overridden: the import lands its own row for
        // `share_1` as usual, and this one sits on the head beside it with
        // no legacy row behind it.
        repository.landedResourceRows.push({
          grantId: "share_invented",
          token: "tok_invented",
          resourceKind: "TRACE",
          resourceId: "trace_1",
          projectId: "proj_chatbot",
          principalType: "ANYONE",
          principalId: null,
          expiresAtMs: null,
          maxViews: null,
          viewCount: 0,
        });

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        expect(
          (outcome.report as { diffs: CutoverResourceDiff[] }).diffs,
        ).toEqual([{ kind: "resource_extra", id: "share_invented" }]);
        expect(
          ledger.calls.some((call) => call.verb === "completeCutover"),
        ).toBe(false);
      });
    });
  });

  describe("given two readers that decide differently for a member", () => {
    const disagreeing = () =>
      new GrantsCutoverMigration({
        repository,
        ledger,
        collectors: {
          legacy: collectorOf({
            grantsFor: (id) => ({
              ...emptyGrants({ principal: { type: "user", id } }),
              organizationRole: "ADMIN",
              isOrgMember: true,
              bindings: [
                {
                  role: "ADMIN",
                  customRoleId: null,
                  scopeType: "ORGANIZATION",
                  scopeId: ORG,
                },
              ],
            }),
          }),
          grants: collectorOf(),
        },
        cutoverCohort: () => cohort,
        now: () => clock++,
        poll: { intervalMs: 1, timeoutMs: 50 },
      });

    beforeEach(() => {
      repository.memberIds = ["user_sam"];
    });

    describe("when a retry visits the principals in a different order", () => {
      it("names the same verdict with the same command id and the same fact", async () => {
        const proofs = () =>
          ledger.calls.filter(
            (call) => call.verb === "proveMigrationParity",
          ) as Array<{ commandId: string; diffs: string[] }>;
        repository.memberIds = ["user_sam", "user_kim"];
        await disagreeing().migrateTenant({ tenantId: ORG });
        const first = proofs()[0]!;
        ledger.calls = [];
        // The proof's identity must be a function of WHAT was found, never
        // of the order the sweep happened to visit principals in - Postgres
        // guarantees no row order, and a retry that named the same verdict
        // differently would append a second fact for one claim.
        repository.memberIds = ["user_kim", "user_sam"];

        await disagreeing().migrateTenant({ tenantId: ORG });

        const second = proofs()[0]!;
        expect(second.commandId).toBe(first.commandId);
        expect(second.diffs).toEqual(first.diffs);
        // The fact's evidence is the sorted list, so the two payloads are
        // byte-identical however the sweep iterated.
        expect(second.diffs).toEqual([...second.diffs].sort());
      });
    });

    describe("when the parity proof sweeps", () => {
      it("records the disagreement as a fact and holds the organization", async () => {
        const outcome = await disagreeing().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        const report = outcome.report as {
          kind: string;
          totalDiffs: number;
          diffs: string[];
        };
        expect(report.kind).toBe("cutover_parity_diffs");
        expect(report.totalDiffs).toBeGreaterThan(0);
        expect(report.diffs.length).toBeLessThanOrEqual(50);
        expect(report.diffs[0]).toMatch(
          /^user:user_sam \S+ organization:org_acme legacy=true engine=false$/,
        );

        const parity = ledger.calls.find(
          (call) => call.verb === "proveMigrationParity",
        );
        expect(parity).toMatchObject({
          commandId: expect.stringMatching(
            new RegExp(`^cutover:parity:${ORG}:`),
          ),
        });
        expect(
          (parity as { diffs: string[] }).diffs.length,
        ).toBeGreaterThan(0);
        expect(
          ledger.calls.some((call) => call.verb === "completeCutover"),
        ).toBe(false);
      });
    });
  });

  describe("given two readers that agree about everyone", () => {
    beforeEach(() => {
      repository.memberIds = ["user_sam"];
      repository.apiKeyIds = ["key_1"];
      repository.inventory = {
        teamIds: ["team_support"],
        projects: [{ id: "proj_chatbot", teamId: "team_support" }],
      };
    });

    describe("when the cutover completes", () => {
      /** @scenario "A clean parity proof and the cutover are recorded as facts" */
      it("proves an empty diff list, completes the cutover, and finalizes", async () => {
        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(ledger.calls).toEqual([
          {
            verb: "proveMigrationParity",
            commandId: expect.stringMatching(
              new RegExp(`^cutover:parity:${ORG}:`),
            ),
            diffs: [],
            occurredAtMs: expect.any(Number),
          },
          {
            verb: "completeCutover",
            organizationId: ORG,
            // The pass's own timestamp: a completion carries no content to
            // be identified by, and an organization may legitimately have
            // to complete twice after a rollback.
            commandId: expect.stringMatching(
              new RegExp(`^cutover:complete:${ORG}:\\d+$`),
            ),
            actor: { type: "system", id: "system:grants-cutover" },
            occurredAtMs: expect.any(Number),
          },
        ]);
        expect(outcome.status).toBe("finalized");
        expect(outcome.report).toMatchObject({
          kind: "cutover_clean",
          membersVerified: 1,
          apiKeysVerified: 1,
        });
      });

      it("parks the organization when the flip never reaches the projection", async () => {
        repository.cutoverNeverLands = true;

        await expect(
          migration().migrateTenant({ tenantId: ORG }),
        ).rejects.toThrow(/did not land the cutover of org_acme/);
      });
    });
  });

  /**
   * The designed operator path: the proof holds the organization, somebody
   * fixes the cause, and the next pass proves clean. What the event store
   * keeps at the end of it has to be the SECOND proof - and with a command id
   * that named only the organization it kept the first, so the ledger's
   * permanent record of a cut-over organization was the failure.
   *
   * The fold is run here rather than asserted about, because "what the ledger
   * ends up saying" is exactly the reducer's answer to these two events.
   */
  describe("given a proof that held the organization and a later one that did not", () => {
    beforeEach(() => {
      repository.memberIds = ["user_sam"];
    });

    describe("when both proofs reach the ledger", () => {
      it("folds to the clean proof, not to the disagreement it replaced", async () => {
        let disagree = true;
        const machine = () =>
          new GrantsCutoverMigration({
            repository,
            ledger,
            collectors: {
              legacy: collectorOf({
                grantsFor: (id) =>
                  disagree
                    ? {
                        ...emptyGrants({ principal: { type: "user", id } }),
                        organizationRole: "ADMIN",
                        isOrgMember: true,
                        bindings: [
                          {
                            role: "ADMIN",
                            customRoleId: null,
                            scopeType: "ORGANIZATION",
                            scopeId: ORG,
                          },
                        ],
                      }
                    : null,
              }),
              grants: collectorOf(),
            },
            cutoverCohort: () => cohort,
            now: () => clock++,
            poll: { intervalMs: 1, timeoutMs: 50 },
          });

        const held = await machine().migrateTenant({ tenantId: ORG });
        disagree = false;
        const clean = await machine().migrateTenant({ tenantId: ORG });

        expect(held.status).toBe("migrated");
        expect(clean.status).toBe("finalized");

        const proofs = ledger.calls.filter(
          (call) => call.verb === "proveMigrationParity",
        ) as Array<{ commandId: string; diffs: string[]; occurredAtMs: number }>;
        expect(proofs).toHaveLength(2);
        // Different claims, different keys - which is the whole fix: an
        // event store that dedupes on the key keeps both.
        expect(proofs[0]!.commandId).not.toBe(proofs[1]!.commandId);

        const folded = foldParityProofs(proofs);
        expect(folded.cutover.parityDiffs).toEqual([]);
        expect(folded.cutover.provedAtMs).toBe(proofs[1]!.occurredAtMs);
      });

      it("keeps one fact per distinct verdict, however many times it re-runs", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        await migration().migrateTenant({ tenantId: ORG });

        const commandIds = ledger.calls
          .filter((call) => call.verb === "proveMigrationParity")
          .map((call) => call.commandId);
        // Two passes, the same clean verdict: the same claim, so the same
        // key, so one fact once the store has deduped it.
        expect(new Set(commandIds).size).toBe(1);
      });
    });
  });

  describe("given an organization cut over, rolled back, and cut over again", () => {
    describe("when the second completion reaches the ledger", () => {
      it("names itself differently, so the flip is not deduped away", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        // The rollback: the projection is pinned back onto legacy, and the
        // next pass has to be able to flip it a second time.
        repository.onEngine = false;

        await migration().migrateTenant({ tenantId: ORG });

        const completions = ledger.calls.filter(
          (call) => call.verb === "completeCutover",
        );
        expect(completions).toHaveLength(2);
        expect(completions[0]!.commandId).not.toBe(completions[1]!.commandId);
      });
    });
  });

  /**
   * The view budget is the one part of a share link the fold does not own, so
   * it is the one part the import can silently drop - and dropping it hands a
   * spent link back to whoever holds the token.
   */
  describe("given a share link a customer has partly used up", () => {
    beforeEach(() => {
      repository.shareLinkRows = [
        shareLinkRow({ id: "share_1", maxViews: 3, viewCount: 2 }),
      ];
    });

    describe("when the cutover imports it", () => {
      it("carries the views already spent onto the usage row", async () => {
        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("finalized");
        expect(repository.seedCalls).toEqual([
          [{ grantId: "share_1", projectId: "proj_chatbot", viewCount: 2 }],
        ]);
        expect(repository.usageRows.get("share_1")).toBe(2);
      });

      it("leaves a budget already handed over alone on a second pass", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        // A view consumed between the two passes: the seed must never walk
        // it back.
        repository.usageRows.set("share_1", 3);

        await migration().migrateTenant({ tenantId: ORG });

        expect(repository.usageRows.get("share_1")).toBe(3);
      });

      /** @scenario "A view spent while an organization is held is handed over on the next pass" */
      it("hands over a view spent on the legacy path between two passes", async () => {
        await migration().migrateTenant({ tenantId: ORG });
        expect(repository.usageRows.get("share_1")).toBe(2);
        // The legacy path is still the org's live path while it is not cut
        // over, so a view lands on ShareLink.viewCount after the seed. A
        // create-only seed left the usage row at 2 forever, the exact-match
        // proof reported viewCount drift on every later pass, and the
        // organization wedged with no operator action that could fix it.
        repository.shareLinkRows = [
          shareLinkRow({ id: "share_1", maxViews: 3, viewCount: 3 }),
        ];

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        // The re-run raised the budget to the legacy count and the proof
        // came back clean - handed over, never refunded.
        expect(repository.usageRows.get("share_1")).toBe(3);
        expect(outcome.status).toBe("finalized");
      });
    });

    describe("when the import reproduced the link with a fresh budget", () => {
      it("holds the organization rather than refilling it silently", async () => {
        repository.resourceGrantRows = [
          {
            grantId: "share_1",
            token: "tok_abc",
            resourceKind: "TRACE",
            resourceId: "trace_1",
            projectId: "proj_chatbot",
            principalType: "ANYONE",
            principalId: null,
            expiresAtMs: null,
            maxViews: 3,
            viewCount: 0,
          },
        ];

        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        const report = outcome.report as {
          kind: string;
          diffs: CutoverResourceDiff[];
        };
        expect(report.kind).toBe("cutover_resource_drift");
        expect(report.diffs).toEqual([
          {
            kind: "resource_changed",
            id: "share_1",
            field: "viewCount",
            expected: "2",
            actual: "0",
          },
        ]);
      });
    });
  });

  /**
   * The third leg (finding: the two-collector proof cannot see a resolver
   * quirk, because both of its sides run the same decision function). The
   * quirk fixture is the shape that comparison is blind to by construction:
   * two readers that agree exactly, and a resolver that answers something
   * else anyway.
   */
  describe("given a legacy resolver that answers differently from the engine", () => {
    beforeEach(() => {
      repository.memberIds = ["user_sam"];
    });

    const withResolver = (
      legacyDecide: NonNullable<
        ConstructorParameters<typeof GrantsCutoverMigration>[0]["legacyDecide"]
      >,
    ) =>
      new GrantsCutoverMigration({
        repository,
        ledger,
        // Both readers agree about everything: the row-level comparison has
        // nothing at all to report.
        collectors: { legacy: collectorOf(), grants: collectorOf() },
        legacyDecide,
        cutoverCohort: () => cohort,
        now: () => clock++,
        poll: { intervalMs: 1, timeoutMs: 50 },
      });

    describe("when the parity proof sweeps", () => {
      it("catches the disagreement the two readers cannot see, as its own family", async () => {
        const outcome = await withResolver(async ({ permission }) =>
          permission === "traces:view" ? true : false,
        ).migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        const report = outcome.report as {
          kind: string;
          diffs: string[];
          resolverSubjectsVerified: number;
        };
        expect(report.kind).toBe("cutover_parity_diffs");
        expect(report.diffs).toEqual([
          `user:user_sam traces:view organization:${ORG} resolver=true engine=false`,
        ]);
        expect(report.resolverSubjectsVerified).toBe(1);
        expect(
          ledger.calls.some((call) => call.verb === "completeCutover"),
        ).toBe(false);
      });

      it("lets the organization through when the resolver agrees too", async () => {
        const outcome = await withResolver(async () => false).migrateTenant({
          tenantId: ORG,
        });

        expect(outcome.status).toBe("finalized");
        expect(outcome.report).toMatchObject({ resolverSubjectsVerified: 1 });
      });
    });

    describe("when no resolver is wired in", () => {
      it("says so in the report rather than reading as clean", async () => {
        const outcome = await migration().migrateTenant({ tenantId: ORG });

        expect(outcome.report).toMatchObject({
          kind: "cutover_clean",
          resolverSubjectsVerified: 0,
        });
      });
    });
  });
});

/** The two parity facts, through the real reducer, in the order the passes
 *  emitted them. */
function foldParityProofs(
  proofs: ReadonlyArray<{ diffs: string[]; occurredAtMs: number }>,
): GrantsLedgerState {
  return proofs.reduce(
    (state, proof) =>
      reduceGrantsLedger({
        state,
        event: {
          kind: "migration_parity_proved",
          diffs: proof.diffs,
          occurredAtMs: proof.occurredAtMs,
        },
      }),
    emptyGrantsLedgerState({ organizationId: ORG }),
  );
}

describe("parityCommandId", () => {
  const line = (index: number) =>
    `user:user_${String(index).padStart(4, "0")} traces:view organization:${ORG} legacy=true engine=false`;

  describe("when two verdicts share their first 200 lines and differ beyond", () => {
    it("names them differently - the id hashes the FULL set, not the truncation", async () => {
      // MAX_PROVEN_DIFFS is 200: the appended fact keeps only that prefix as
      // evidence, so the prefix alone cannot be the claim's identity.
      const shared = Array.from({ length: 200 }, (_, index) => line(index));
      const verdictA = [...shared, line(900)];
      const verdictB = [...shared, line(901)];

      expect(
        parityCommandId({ organizationId: ORG, diffs: verdictA }),
      ).not.toBe(parityCommandId({ organizationId: ORG, diffs: verdictB }));
    });

    it("also separates a verdict from its own truncation - the count travels with the digest", async () => {
      const shared = Array.from({ length: 200 }, (_, index) => line(index));

      expect(
        parityCommandId({ organizationId: ORG, diffs: [...shared, line(900)] }),
      ).not.toBe(parityCommandId({ organizationId: ORG, diffs: shared }));
    });
  });
});
