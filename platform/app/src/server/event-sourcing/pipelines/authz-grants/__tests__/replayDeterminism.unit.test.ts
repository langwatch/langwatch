import {
  type AuthzMigrationRepository,
  type ExistingTeamBinding,
  grantFactToCompatBinding,
  grantFactToCompatShareLink,
  grantFactToRow,
  type LegacyTeamRow,
} from "@langwatch/authz-server";
import {
  type BackfillGrantEmission,
  deriveGrantId,
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
} from "@langwatch/authz-server/migration";
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../..";
import { AttachGrantsCommand } from "../commands/grantsLedgerCommands";
import { AuthzGrantsStateFoldProjection } from "../projections/authzGrantsState.foldProjection";
import type { AuthzGrantsEvent } from "../schemas/events";

const ORG = "org_acme";

/**
 * PR 1's definition of done (delivery plan): replaying an organization's
 * stream reproduces the imperative M1 writer's rows. The whole pure chain
 * runs twice from the same legacy rows - the migration's emission mapping,
 * the attachGrants command handler, the wire schemas, the reducer, the row
 * mappings - and the produced rows must be byte-identical across runs.
 *
 * The one deliberate difference from the retired M1 writer is identity: ids
 * are derived from event content where M1 minted random KSUIDs. Every column
 * a decision reads is written the way M1 wrote it, `role` included - which
 * is what the third block below pins.
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

/**
 * One resource fact rides the same stream: the cutover import adopts a share
 * link's id and business time, so the emission is a pure function of the
 * legacy row exactly like the team bindings are — and the row it projects
 * (Grant plus the compat ShareLink head) has to come out byte-identical on
 * every replay for the same reason.
 */
const SHARE_LINK_ROW = {
  resourceId: "trace_2Zk",
  projectId: "proj_chatbot",
  token: "tok_shared_1",
  createdAtMs: 1_690_000_240_000,
  createdByUserId: "user_sam",
};

const SHARE_EMISSION: BackfillGrantEmission = {
  grantId: deriveGrantId({
    organizationId: ORG,
    principal: { type: "anyone", id: null },
    scope: { type: "RESOURCE", id: SHARE_LINK_ROW.resourceId },
    resourceToken: SHARE_LINK_ROW.token,
    occurredAtMs: SHARE_LINK_ROW.createdAtMs,
  }),
  principal: { type: "anyone", id: null },
  roleKey: null,
  scope: { type: "RESOURCE", id: SHARE_LINK_ROW.resourceId },
  resource: {
    kind: "trace",
    projectId: SHARE_LINK_ROW.projectId,
    token: SHARE_LINK_ROW.token,
    permission: "traces:view",
    createdByUserId: SHARE_LINK_ROW.createdByUserId,
  },
  source: "cutover-import",
  occurredAtMs: SHARE_LINK_ROW.createdAtMs,
  actor: { type: "system", id: "system:cutover-import" },
};

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
    // The backfill defines no roles — it only binds users to teams — but the
    // emitter is one interface, so the stub implements all of it.
    defineRoles: async () => undefined,
    revokeGrants: async () => undefined,
    deleteRole: async () => undefined,
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
  return [...emitted, SHARE_EMISSION];
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
  const projection = new AuthzGrantsStateFoldProjection({
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
    shareRows: grants.flatMap((grant) => {
      const row = grantFactToCompatShareLink({ grant, organizationId: ORG });
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
      // The resource tier replays the same way: one share link in, one
      // compat row out, identical down to the bytes.
      expect(first.shareRows).toHaveLength(1);
      expect(JSON.stringify(second.shareRows)).toBe(
        JSON.stringify(first.shareRows),
      );
    });

    it("applying the stream twice folds to the same state as once", async () => {
      const emissions = await captureEmissions();
      const once = await replayToRows(emissions);
      // What this proves is the REDUCER's idempotency: every apply is an
      // absolute write keyed by a deterministic grant id, so folding a fact
      // a second time moves nothing.
      //
      // It is deliberately not a claim about store-level dedup. These
      // entries are re-indexed on the way through the command handler, so
      // the second copy carries its own `<commandId>:<index>` keys rather
      // than colliding with the first — the retried-command contract lives
      // at the event store and is proven where that dedup happens.
      const twice = await replayToRows([...emissions, ...emissions]);
      expect(JSON.stringify(twice.grantRows)).toBe(
        JSON.stringify(once.grantRows),
      );
    });
  });

  /**
   * This block pins the SHAPE of the compat row the chain produces against a
   * hand-written expectation - it has no copy of the retired M1 writer to
   * compare against, so it states the shape that writer produced rather than
   * executing it.
   */
  describe("when the compat rows the chain produced are inspected", () => {
    it("pins one binding per legacy row, carrying that row's own role", async () => {
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
          // Custom rows keep the legacy row's role too: the resolver falls
          // back to it whenever the custom role's permission list is empty,
          // so normalizing it to CUSTOM would answer viewer where the legacy
          // row answered admin.
          role: legacy.role,
        });
      }
    });
  });
});
