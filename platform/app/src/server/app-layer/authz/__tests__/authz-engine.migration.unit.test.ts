/**
 * The ADR-110 authz-engine migration: every legacy table stated as facts,
 * the deny direction reconciled, and the one-read check that decides
 * finalized against held.
 *
 * @see specs/migration/authz-grants-rollout.feature
 */

import type {
  ExternalMemberFact,
  GrantFact,
  LegacyBindingRow,
  LegacyRoleRow,
  LegacyTeamRow,
  OrganizationMemberFact,
  ProjectCredentialFact,
  ResourceGrantRow,
  ResourceGrantUsageSeed,
  RoleFact,
  RoleHeadRow,
  ShareLinkFactRow,
} from "@langwatch/authz-server";
import { describe, expect, it } from "vitest";
import {
  AuthzEngineMigration,
  type AuthzEngineMigrationStore,
  type GrantHeadRow,
} from "../authz-engine.migration";

const ORG_ID = "org_acme";
const NOW = 1_800_000_000_000;
const CREATED = 1_700_000_000_000;

type Sent = {
  kind:
    | "attachGrant"
    | "defineRole"
    | "changeGrantRole"
    | "changeRolePermissions"
    | "revokeGrant"
    | "deleteRole";
  commandId: string;
  payload: Record<string, unknown>;
};

type Data = {
  organizationCreatedAtMs?: number | null;
  roles?: LegacyRoleRow[];
  bindings?: LegacyBindingRow[];
  members?: OrganizationMemberFact[];
  teamRows?: LegacyTeamRow[];
  shareLinks?: ShareLinkFactRow[];
  externalMembers?: ExternalMemberFact[];
  credentials?: ProjectCredentialFact[];
  grantHeads?: GrantHeadRow[];
  roleHeads?: RoleHeadRow[];
  resourceRows?: ResourceGrantRow[];
};

function harness(data: Data = {}) {
  const sent: Sent[] = [];
  const seeded: ResourceGrantUsageSeed[][] = [];
  const reads = { heads: 0 };
  const store: AuthzEngineMigrationStore = {
    findOrganizationCreatedAtMs: async () =>
      data.organizationCreatedAtMs === undefined
        ? CREATED
        : data.organizationCreatedAtMs,
    findLegacyRoleRows: async () => data.roles ?? [],
    findLegacyBindingRows: async () => data.bindings ?? [],
    findOrganizationMembers: async () => data.members ?? [],
    findLegacyTeamRows: async () => data.teamRows ?? [],
    findShareLinkRows: async () => data.shareLinks ?? [],
    findExternalMemberFacts: async () => data.externalMembers ?? [],
    findProjectCredentialFacts: async () => data.credentials ?? [],
    findGrantHeadRows: async () => {
      reads.heads += 1;
      return data.grantHeads ?? [];
    },
    findRoleHeads: async () => data.roleHeads ?? [],
    findResourceGrantRows: async () => data.resourceRows ?? [],
    seedResourceGrantUsage: async ({ seeds }) => {
      seeded.push([...seeds]);
    },
  };
  const record =
    (kind: Sent["kind"]) =>
    async ({
      commandId,
      ...payload
    }: { commandId: string } & Record<string, unknown>) => {
      sent.push({ kind, commandId, payload });
    };
  const migration = new AuthzEngineMigration({
    store,
    ledger: {
      attachGrant: record("attachGrant"),
      defineRole: record("defineRole"),
      changeGrantRole: record("changeGrantRole"),
      changeRolePermissions: record("changeRolePermissions"),
      revokeGrant: record("revokeGrant"),
      deleteRole: record("deleteRole"),
    },
    now: () => NOW,
  });
  return { migration, sent, seeded, reads };
}

function attachedFacts(sent: Sent[]): GrantFact[] {
  return sent
    .filter((entry) => entry.kind === "attachGrant")
    .map((entry) => entry.payload.grant as GrantFact);
}

function member(userId: string, role = "MEMBER"): OrganizationMemberFact {
  return { userId, role, createdAtMs: CREATED };
}

function binding(overrides: Partial<LegacyBindingRow> = {}): LegacyBindingRow {
  return {
    id: "binding_1",
    userId: "user_1",
    groupId: null,
    apiKeyId: null,
    role: "MEMBER",
    customRoleId: null,
    scopeType: "PROJECT",
    scopeId: "project_1",
    createdAtMs: CREATED,
    ...overrides,
  };
}

function shareLink(
  overrides: Partial<ShareLinkFactRow> = {},
): ShareLinkFactRow {
  return {
    id: "share_1",
    token: "token_1",
    resourceType: "TRACE",
    resourceId: "trace_1",
    projectId: "project_1",
    userId: "user_1",
    visibility: "PUBLIC",
    expiresAtMs: null,
    maxViews: null,
    viewCount: 0,
    createdAtMs: CREATED,
    ...overrides,
  };
}

/** The head row a folded attach of `fact` would produce — for tests that
 *  start from a converged projection. */
function foldedHead(fact: GrantFact): GrantHeadRow {
  const stored: Record<string, string> = {
    user: "USER",
    group: "GROUP",
    apiKey: "API_KEY",
    team: "TEAM",
    project: "PROJECT",
    organization: "ORGANIZATION",
    anyone: "ANYONE",
  };
  return {
    id: fact.grantId,
    principalType: stored[fact.principal.type] ?? fact.principal.type,
    principalId: fact.principal.id,
    roleKey: fact.roleKey,
    legacyRole: fact.legacyRole ?? null,
    source: "migration",
    scopeType: fact.scope.type,
    scopeId: fact.scope.id,
    revoked: false,
  };
}

describe("given an organization with legacy access rows", () => {
  describe("when the migration states its facts", () => {
    /** @scenario "Every legacy table is a source of facts" */
    it("states every legacy table's rows as facts", async () => {
      const { migration, sent } = harness({
        members: [
          member("user_member"),
          member("user_admin", "ADMIN"),
          member("user_external", "EXTERNAL"),
        ],
        externalMembers: [{ userId: "user_external", createdAtMs: CREATED }],
        teamRows: [
          {
            userId: "user_member",
            teamId: "team_1",
            role: "MEMBER",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
        bindings: [binding()],
        roles: [
          {
            id: "role_1",
            name: "Auditor",
            description: null,
            permissions: ["traces:view"],
            kind: "custom",
            createdAtMs: CREATED,
          },
        ],
        shareLinks: [shareLink()],
        credentials: [{ projectId: "project_1", createdAtMs: CREATED }],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const facts = attachedFacts(sent);
      const roleKeys = facts.map((fact) => fact.roleKey);
      // The member floor, once, as the organization's own principal.
      expect(
        facts.filter((fact) => fact.principal.type === "organization"),
      ).toHaveLength(1);
      // The unbound ADMIN's fallback fact, under its dormant key.
      expect(roleKeys).toContain("legacy-admin");
      // The EXTERNAL membership's cap.
      expect(roleKeys).toContain("lite-member");
      // The team membership, at TEAM scope.
      expect(
        facts.some(
          (fact) =>
            fact.scope.type === "TEAM" && fact.principal.id === "user_member",
        ),
      ).toBe(true);
      // The binding, adopting its row id.
      expect(facts.some((fact) => fact.grantId === "binding_1")).toBe(true);
      // The custom role, adopting its row id.
      expect(
        sent.some(
          (entry) =>
            entry.kind === "defineRole" &&
            (entry.payload.role as RoleFact).roleId === "role_1",
        ),
      ).toBe(true);
      // The share link, as a RESOURCE fact keeping its id and token.
      const resource = facts.find((fact) => fact.grantId === "share_1");
      expect(resource?.scope.type).toBe("RESOURCE");
      expect(resource?.resource?.token).toBe("token_1");
      // The project credential, with the project itself as principal.
      expect(
        facts.some(
          (fact) =>
            fact.principal.type === "project" &&
            fact.scope.type === "PROJECT" &&
            fact.scope.id === "project_1",
        ),
      ).toBe(true);
      // Every fact carries the migration's source.
      expect(new Set(facts.map((fact) => fact.source))).toEqual(
        new Set(["migration"]),
      );
    });

    /** @scenario "Team membership is stated directly, not promoted first" */
    it("states memberships as grants and writes no binding row", async () => {
      const { migration, sent } = harness({
        teamRows: [
          {
            userId: "user_1",
            teamId: "team_1",
            role: "ADMIN",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const teamFacts = attachedFacts(sent).filter(
        (fact) => fact.scope.type === "TEAM",
      );
      expect(teamFacts).toHaveLength(1);
      expect(teamFacts[0]?.roleKey).toBe("admin");
      // Derived identity, not a minted binding row: the id is a grant KSUID.
      expect(teamFacts[0]?.grantId).toMatch(/^grant_/);
    });

    /** @scenario "Team membership is stated directly, not promoted first" */
    it("does not restate a membership a team binding already carries", async () => {
      const { migration, sent } = harness({
        teamRows: [
          {
            userId: "user_1",
            teamId: "team_1",
            role: "MEMBER",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
        bindings: [
          binding({
            id: "binding_team",
            scopeType: "TEAM",
            scopeId: "team_1",
            role: "MEMBER",
          }),
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const teamFacts = attachedFacts(sent).filter(
        (fact) => fact.scope.type === "TEAM",
      );
      expect(teamFacts.map((fact) => fact.grantId)).toEqual(["binding_team"]);
    });

    /** @scenario "The organization member floor is stated once" */
    it("floors an unbound member with the organization grant and nothing else", async () => {
      const { migration, sent } = harness({
        members: [member("user_lonely")],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const facts = attachedFacts(sent);
      expect(facts).toHaveLength(1);
      expect(facts[0]?.principal).toEqual({
        type: "organization",
        id: ORG_ID,
      });
      expect(facts[0]?.roleKey).toBe("member");
    });

    /** @scenario "An imported grant keeps the time it was originally made" */
    it("carries the legacy row's own time as the fact's business time", async () => {
      const { migration, sent } = harness({ bindings: [binding()] });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(attachedFacts(sent)[0]?.occurredAtMs).toBe(CREATED);
    });
  });

  describe("when the pass checks the projection", () => {
    /** @scenario "The migration states its facts and checks once" */
    it("reads the projection once and does not poll", async () => {
      const { migration, reads } = harness({ bindings: [binding()] });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(reads.heads).toBe(1);
    });

    /** @scenario "A projection that has not caught up holds the organization" */
    it("holds the organization with the outstanding count", async () => {
      const { migration } = harness({
        bindings: [binding()],
        organizationCreatedAtMs: null,
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("migrated");
      const report = outcome.report as { outstanding: number };
      expect(report.outstanding).toBe(1);
    });

    /** @scenario "A held organization names what is outstanding" */
    it("names the outstanding ids in the held report", async () => {
      const { migration } = harness({ bindings: [binding()] });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      const report = outcome.report as { outstandingSample: string[] };
      expect(report.outstandingSample).toContain("binding_1");
    });

    /** @scenario "The check that precedes finalizing is proven, not assumed" */
    it("does not finalize a projection that disagrees, and names the disagreement", async () => {
      const drifted = binding();
      const { migration, sent } = harness({
        bindings: [drifted],
        organizationCreatedAtMs: null,
        grantHeads: [
          {
            ...foldedHead({
              grantId: drifted.id,
              principal: { type: "user", id: "user_1" },
              roleKey: "member",
              scope: { type: "PROJECT", id: "project_1" },
              source: "migration",
              occurredAtMs: CREATED,
            }),
            roleKey: "admin",
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("migrated");
      const report = outcome.report as {
        diffs: Array<{ kind: string; id: string; field?: string }>;
      };
      expect(report.diffs).toContainEqual(
        expect.objectContaining({
          kind: "grant_changed",
          id: "binding_1",
          field: "roleKey",
        }),
      );
      // And the drift is repaired for the next pass, as a proper role change.
      expect(
        sent.some(
          (entry) =>
            entry.kind === "changeGrantRole" &&
            entry.payload.grantId === "binding_1" &&
            entry.payload.to === "member",
        ),
      ).toBe(true);
    });

    // "An organization reads from the projection the moment it finalizes"
    // stays @integration — the moment itself is the engine gate's read, which
    // this unit harness cannot honestly observe. What it CAN pin is the
    // precondition: a projection holding exactly what legacy holds finalizes.
    it("finalizes when the projection holds exactly what legacy holds", async () => {
      const row = binding();
      const fact: GrantFact = {
        grantId: row.id,
        principal: { type: "user", id: "user_1" },
        roleKey: "member",
        scope: { type: "PROJECT", id: "project_1" },
        source: "migration",
        occurredAtMs: CREATED,
      };
      const { migration } = harness({
        bindings: [row],
        organizationCreatedAtMs: null,
        grantHeads: [foldedHead(fact)],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("finalized");
    });
  });

  describe("when the migration runs again", () => {
    /** @scenario "Re-running the migration states the same facts" */
    it("derives the same ids and the same command ids", async () => {
      const data: Data = {
        members: [member("user_1")],
        teamRows: [
          {
            userId: "user_1",
            teamId: "team_1",
            role: "MEMBER",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
        bindings: [binding()],
      };
      const first = harness(data);
      const second = harness(data);

      await first.migration.migrateTenant({ tenantId: ORG_ID });
      await second.migration.migrateTenant({ tenantId: ORG_ID });

      const ids = (sent: Sent[]) =>
        sent.map((entry) => `${entry.kind}:${entry.commandId}`).sort();
      expect(ids(second.sent)).toEqual(ids(first.sent));
    });

    /** @scenario "A pass that failed partway is safe to repeat" */
    it("restates every fact under the command id the first attempt used", async () => {
      const data: Data = {
        bindings: [binding()],
        organizationCreatedAtMs: null,
      };
      const failing = harness(data);
      let calls = 0;
      const ledgerAttach = failing.migration as unknown as {
        deps: { ledger: { attachGrant: (args: unknown) => Promise<void> } };
      };
      const original = ledgerAttach.deps.ledger.attachGrant;
      ledgerAttach.deps.ledger.attachGrant = async (args) => {
        calls += 1;
        if (calls === 1) throw new Error("queue hiccup");
        return original(args);
      };

      await expect(
        failing.migration.migrateTenant({ tenantId: ORG_ID }),
      ).rejects.toThrow("queue hiccup");

      const retry = await failing.migration.migrateTenant({ tenantId: ORG_ID });
      expect(retry.status).toBe("migrated");
      const commandIds = failing.sent
        .filter((entry) => entry.kind === "attachGrant")
        .map((entry) => entry.commandId);
      // The retry's command id equals what the failed attempt would have
      // sent, so the event store dedupes rather than duplicating.
      expect(new Set(commandIds).size).toBe(1);
    });

    /** @scenario "A row deleted on the legacy side is revoked, not left behind" */
    it("revokes a migration-owned head fact whose legacy row is gone", async () => {
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        grantHeads: [
          foldedHead({
            grantId: "grant_orphan",
            principal: { type: "user", id: "user_gone" },
            roleKey: "member",
            scope: { type: "PROJECT", id: "project_1" },
            source: "migration",
            occurredAtMs: CREATED,
          }),
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(
        sent.filter(
          (entry) =>
            entry.kind === "revokeGrant" &&
            entry.payload.grantId === "grant_orphan",
        ),
      ).toHaveLength(1);
    });

    /** @scenario "A row deleted on the legacy side is revoked, not left behind" */
    it("leaves live-write facts alone: only migration-owned sources reconcile", async () => {
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        grantHeads: [
          {
            ...foldedHead({
              grantId: "grant_live",
              principal: { type: "user", id: "user_live" },
              roleKey: "member",
              scope: { type: "PROJECT", id: "project_1" },
              source: "grants-service",
              occurredAtMs: CREATED,
            }),
            source: "grants-service",
          },
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(sent.filter((entry) => entry.kind === "revokeGrant")).toHaveLength(
        0,
      );
    });
  });

  describe("when share links carry a view budget", () => {
    it("hands the budget over on every pass", async () => {
      const { migration, seeded } = harness({
        shareLinks: [shareLink({ maxViews: 10, viewCount: 3 })],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(seeded).toEqual([
        [{ grantId: "share_1", projectId: "project_1", viewCount: 3 }],
      ]);
    });
  });
});
