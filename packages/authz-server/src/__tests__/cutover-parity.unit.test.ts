/**
 * The decision-parity proof on its own (D-PR3-12): two readers, one pure
 * engine, every permission in the registry at every scope. The collectors
 * are stubs so the snapshots are fabricated exactly — what is under test is
 * the comparison, and the engine deciding it is the real one.
 */
import type { CollectedGrants } from "@langwatch/authz";
import type { TenantMigrationStatus } from "@langwatch/system-migrations";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthzCollectorService } from "../authz-collector.service";
import type {
  AuthzCutoverRepository,
  ExternalMemberFact,
  OrganizationScopeInventory,
  PlatformAdminUserFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ShareLinkFactRow,
} from "../authz-migration.repository";
import { GrantsCutoverMigration } from "../cutover.migration";
import { GRANTS_GENESIS_IMPORT_MIGRATION_NAME } from "../genesis-import.name";
import type { GrantsLedgerEmitter } from "../team-user-backfill.migration";
import { TEAM_USER_BACKFILL_MIGRATION_NAME } from "../team-user-backfill.name";

const ORG = "org_acme";
const USER = "user_sam";
const TEAM = "team_support";
const PROJECT = "proj_chatbot";

/** Both prerequisites finalized, nothing to import: the sweep is the only
 *  thing this repository is asked about. */
class SweepRepository implements AuthzCutoverRepository {
  onEngine = false;

  async findMigrationTenantStatuses(): Promise<
    Record<string, TenantMigrationStatus | null>
  > {
    return {
      [TEAM_USER_BACKFILL_MIGRATION_NAME]: "finalized",
      [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: "finalized",
    };
  }
  async findShareLinkRows(): Promise<ShareLinkFactRow[]> {
    return [];
  }
  async findExternalMemberFacts(): Promise<ExternalMemberFact[]> {
    return [];
  }
  async findProjectCredentialFacts(): Promise<ProjectCredentialFact[]> {
    return [];
  }
  async findUsersByEmail(): Promise<PlatformAdminUserFact[]> {
    return [];
  }
  async findResourceGrantRows(): Promise<ResourceGrantRow[]> {
    return [];
  }
  async seedResourceGrantUsage(): Promise<void> {
    throw new Error("this organization holds no share links to seed");
  }
  async findOrganizationScopeInventory(): Promise<OrganizationScopeInventory> {
    return { teamIds: [TEAM], projects: [{ id: PROJECT, teamId: TEAM }] };
  }
  async findOrganizationMemberIds(): Promise<string[]> {
    return [USER];
  }
  async findOrganizationApiKeyIds(): Promise<string[]> {
    return [];
  }
  async findGrantHeadIds(): Promise<string[]> {
    return [];
  }
  async findCutoverOnEngine(): Promise<boolean> {
    this.onEngine = true;
    return true;
  }
}

class RecordingLedger implements GrantsLedgerEmitter {
  parityDiffs: string[][] = [];
  completed = 0;

  async attachGrants(): Promise<void> {
    throw new Error("this organization has nothing to import");
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
  async proveMigrationParity({ diffs }: { diffs: string[] }): Promise<void> {
    this.parityDiffs.push(diffs);
  }
  async completeCutover(): Promise<void> {
    this.completed += 1;
  }
}

/** A member of the organization, holding whatever bindings a test gives it.
 *  The two snapshots differ ONLY where a test makes them differ. */
function memberSnapshot({
  bindings = [],
  customRolePermissions = new Map<string, readonly string[]>(),
}: {
  bindings?: CollectedGrants["bindings"];
  customRolePermissions?: ReadonlyMap<string, readonly string[]>;
} = {}): CollectedGrants {
  return {
    principal: { type: "user", id: USER },
    organizationId: ORG,
    organizationRole: "MEMBER",
    isOrgMember: true,
    bindings,
    legacyTeamMemberships: [],
    customRolePermissions,
  };
}

function collectorReturning(grants: CollectedGrants): AuthzCollectorService {
  return {
    collectGrants: async () => grants,
    findApiKeyOwner: async () => null,
  } as unknown as AuthzCollectorService;
}

function sweepWith({
  legacy,
  grants,
  ledger,
}: {
  legacy: CollectedGrants;
  grants: CollectedGrants;
  ledger: RecordingLedger;
}): GrantsCutoverMigration {
  return new GrantsCutoverMigration({
    repository: new SweepRepository(),
    ledger,
    collectors: {
      legacy: collectorReturning(legacy),
      grants: collectorReturning(grants),
    },
    cutoverCohort: () => true,
    adminEmails: () => [],
    now: () => Date.now(),
    poll: { intervalMs: 1, timeoutMs: 50 },
  });
}

describe("the cutover's decision-parity proof", () => {
  let ledger: RecordingLedger;

  beforeEach(() => {
    ledger = new RecordingLedger();
  });

  describe("given the grants reader missing a binding the legacy reader has", () => {
    describe("when the proof sweeps every permission at every scope", () => {
      it("names the exact decision that moved, and nothing else", async () => {
        // A custom role granting one permission at one project: the whole
        // disagreement is that single (permission, scope) pair, so the diff
        // list is exactly one line and any over-reporting shows up.
        const legacy = memberSnapshot({
          bindings: [
            {
              role: "CUSTOM",
              customRoleId: "cr_analyst",
              scopeType: "PROJECT",
              scopeId: PROJECT,
            },
          ],
          customRolePermissions: new Map([["cr_analyst", ["traces:view"]]]),
        });

        const outcome = await sweepWith({
          legacy,
          grants: memberSnapshot(),
          ledger,
        }).migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("migrated");
        expect(outcome.report).toMatchObject({
          kind: "cutover_parity_diffs",
          totalDiffs: 1,
          diffs: [
            `user:${USER} traces:view project:${PROJECT} legacy=true engine=false`,
          ],
        });
        // The argument is a fact before it is a report.
        expect(ledger.parityDiffs).toEqual([
          [`user:${USER} traces:view project:${PROJECT} legacy=true engine=false`],
        ]);
        expect(ledger.completed).toBe(0);
      });
    });
  });

  describe("given two readers that collect the same thing", () => {
    describe("when the proof sweeps", () => {
      it("finds nothing to say and lets the organization cut over", async () => {
        const bindings: CollectedGrants["bindings"] = [
          {
            role: "ADMIN",
            customRoleId: null,
            scopeType: "TEAM",
            scopeId: TEAM,
          },
        ];

        const outcome = await sweepWith({
          legacy: memberSnapshot({ bindings }),
          grants: memberSnapshot({ bindings }),
          ledger,
        }).migrateTenant({ tenantId: ORG });

        expect(outcome.status).toBe("finalized");
        expect(ledger.parityDiffs).toEqual([[]]);
        expect(ledger.completed).toBe(1);
      });
    });
  });
});
