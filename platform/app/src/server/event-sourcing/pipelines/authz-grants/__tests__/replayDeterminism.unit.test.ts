import {
  type AuthzMigrationRepository,
  type ExistingTeamBinding,
  grantFactToCompatBinding,
  grantFactToRow,
  type LegacyTeamRow,
} from "@langwatch/authz-server";
import {
  type BackfillGrantEmission,
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
} from "@langwatch/authz-server/migration";
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../..";
import { AttachGrantsCommand } from "../commands/grantsLedgerCommands";
import { createAuthzGrantsStateProjection } from "../projections/authzGrantsState.projection";
import type { AuthzGrantsEvent } from "../schemas/events";

const ORG = "org_acme";

/**
 * PR 1's definition of done (delivery plan): replaying an organization's
 * stream reproduces the imperative M1 writer's rows. The whole pure chain
 * runs twice from the same legacy rows - the migration's emission mapping,
 * the attachGrants command handler, the wire schemas, the reducer, the row
 * mappings - and the produced rows must be byte-identical across runs, and
 * equivalent to what the retired imperative writer wrote for the same rows.
 *
 * "Equivalent", not byte-identical, against the OLD writer: ids are now
 * deterministic grant ids where M1 minted random KSUIDs, and a custom-role
 * binding's `role` column is normalized to CUSTOM where M1 copied the
 * legacy row's role verbatim - the partial unique indexes and the resolver
 * both key custom bindings on `customRoleId`, so neither difference can
 * change a decision.
 */

const LEGACY_ROWS: LegacyTeamRow[] = [
  {
    userId: "user_sam",
    teamId: "team_support",
    role: "ADMIN",
    customRoleId: null,
    createdAtMs: 1_690_000_000_000,
  },
  {
    userId: "user_robin",
    teamId: "team_support",
    role: "MEMBER",
    customRoleId: null,
    createdAtMs: 1_690_000_060_000,
  },
  {
    userId: "user_kai",
    teamId: "team_platform",
    role: "VIEWER",
    customRoleId: "cr_reader",
    createdAtMs: 1_690_000_120_000,
  },
  {
    userId: "user_pat",
    teamId: "team_platform",
    role: "ADMIN",
    customRoleId: "cr_ops",
    createdAtMs: 1_690_000_180_000,
  },
];

/** Emissions captured through the migration's own public seam, with the
 *  fake ledger landing compat rows so the projection wait converges. */
async function captureEmissions(): Promise<BackfillGrantEmission[]> {
  const bindings: ExistingTeamBinding[] = [];
  const emitted: BackfillGrantEmission[] = [];
  const repository: AuthzMigrationRepository = {
    findLegacyTeamRows: async () => LEGACY_ROWS,
    findExistingTeamBindings: async () => bindings,
    createTeamBindings: async () => 0,
    findOrganizationScopeInventory: async () => ({
      teamIds: ["team_support", "team_platform"],
      projects: [],
    }),
  };
  const ledger: GrantsLedgerEmitter = {
    attachGrants: async ({ grants }) => {
      emitted.push(...grants);
      for (const grant of grants) {
        const row = grantFactToCompatBinding({ grant, organizationId: ORG });
        if (!row || row.userId === null) continue;
        bindings.push({
          userId: row.userId,
          teamId: row.scopeId,
          role: row.role,
          customRoleId: row.customRoleId,
        });
      }
    },
    proveMigrationParity: async () => undefined,
  };
  const migration = new TeamUserBackfillMigration({
    repository,
    // Nobody carries legacy memberships in the collected snapshot, so the
    // sweep is trivially clean - this test is about the write chain.
    collectGrants: async ({ principal }) => ({
      principal: { type: "user", id: principal.id },
      organizationId: ORG,
      organizationRole: "MEMBER",
      isOrgMember: true,
      bindings: [],
      legacyTeamMemberships: [],
      customRolePermissions: new Map(),
    }),
    ledger,
    audit: async () => undefined,
    bumpEpoch: async () => undefined,
    now: () => 1_700_000_000_000,
    poll: { intervalMs: 1, timeoutMs: 50 },
  });
  await migration.migrateTenant({ tenantId: ORG });
  return emitted;
}

/** The rest of the chain: command handler → wire events → fold → rows. */
async function replayToRows(emissions: BackfillGrantEmission[]) {
  const events = await new AttachGrantsCommand().handle({
    tenantId: createTenantId(ORG),
    aggregateId: ORG,
    type: "lw.authz_grants.attach_grants",
    data: {
      tenantId: ORG,
      organizationId: ORG,
      commandId: `backfill-b:${ORG}:0`,
      grants: emissions,
    },
  } as never);
  const projection = createAuthzGrantsStateProjection({
    store: {
      load: () => Promise.resolve(null),
      store: () => Promise.resolve(),
    },
  });
  let state = projection.init();
  for (const event of events) {
    state = projection.apply(state, event as AuthzGrantsEvent);
  }
  const grants = Object.values(state.grants).sort((a, b) =>
    a.grantId.localeCompare(b.grantId),
  );
  return {
    state,
    grantRows: grants.map((grant) =>
      grantFactToRow({ grant, organizationId: ORG }),
    ),
    compatRows: grants.flatMap((grant) => {
      const row = grantFactToCompatBinding({ grant, organizationId: ORG });
      return row ? [row] : [];
    }),
  };
}

describe("grants ledger replay determinism", () => {
  describe("when the same organization's stream replays", () => {
    /** @scenario "Replaying an organization's stream reproduces the writer's rows" */
    it("produces byte-identical rows on every run", async () => {
      const first = await replayToRows(await captureEmissions());
      const second = await replayToRows(await captureEmissions());

      expect(JSON.stringify(second.grantRows)).toBe(
        JSON.stringify(first.grantRows),
      );
      expect(JSON.stringify(second.compatRows)).toBe(
        JSON.stringify(first.compatRows),
      );
    });

    it("applying the stream twice folds to the same state as once", async () => {
      const emissions = await captureEmissions();
      const once = await replayToRows(emissions);
      // A crash-retry replays the same events over the folded state; every
      // apply is an absolute write keyed by deterministic id, so nothing
      // moves.
      const twice = await replayToRows([...emissions, ...emissions]);
      expect(JSON.stringify(twice.grantRows)).toBe(
        JSON.stringify(once.grantRows),
      );
    });
  });

  describe("when the rows are compared with the imperative writer's output", () => {
    it("lands one equivalent compat binding per legacy row", async () => {
      const { compatRows } = await replayToRows(await captureEmissions());

      expect(compatRows).toHaveLength(LEGACY_ROWS.length);
      for (const legacy of LEGACY_ROWS) {
        const row = compatRows.find(
          (candidate) =>
            candidate.userId === legacy.userId &&
            candidate.scopeId === legacy.teamId,
        );
        expect(row).toMatchObject({
          organizationId: ORG,
          scopeType: "TEAM",
          customRoleId: legacy.customRoleId,
          // Custom rows normalize role to CUSTOM; builtin rows keep theirs.
          role: legacy.customRoleId === null ? legacy.role : "CUSTOM",
        });
      }
    });
  });
});
