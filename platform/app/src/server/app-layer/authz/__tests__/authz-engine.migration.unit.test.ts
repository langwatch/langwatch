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
  GrantHeadRow,
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
import { PRINCIPAL_TO_DB } from "@langwatch/authz-server";
import { describe, expect, it } from "vitest";
import {
  AuthzEngineMigration,
  type AuthzEngineMigrationStore,
} from "../authz-engine.migration";

const ORG_ID = "org_acme";
const NOW = 1_800_000_000_000;
const CREATED = 1_700_000_000_000;

type Sent = {
  kind:
    | "attachGrant"
    | "defineRole"
    | "changeGrantRole"
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
  groupMemberships?: Array<{ userId: string; groupId: string }>;
  grantHeads?: GrantHeadRow[];
  roleHeads?: RoleHeadRow[];
  resourceRows?: ResourceGrantRow[];
};

type Ledger = ConstructorParameters<typeof AuthzEngineMigration>[0]["ledger"];

function harness(
  data: Data = {},
  options: { wrapLedger?: (ledger: Ledger) => Ledger } = {},
) {
  const sent: Sent[] = [];
  const seeded: ResourceGrantUsageSeed[][] = [];
  const reads = { grantHeads: 0, roleHeads: 0, resourceRows: 0 };
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
    findGroupMemberships: async () => data.groupMemberships ?? [],
    findGrantHeadRows: async () => {
      reads.grantHeads += 1;
      return data.grantHeads ?? [];
    },
    findRoleHeads: async () => {
      reads.roleHeads += 1;
      return data.roleHeads ?? [];
    },
    findResourceGrantRows: async () => {
      reads.resourceRows += 1;
      return data.resourceRows ?? [];
    },
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
  const recording: Ledger = {
    attachGrant: record("attachGrant"),
    defineRole: record("defineRole"),
    changeGrantRole: record("changeGrantRole"),
    revokeGrant: record("revokeGrant"),
    deleteRole: record("deleteRole"),
  };
  const migration = new AuthzEngineMigration({
    store,
    ledger: options.wrapLedger ? options.wrapLedger(recording) : recording,
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
 *  start from a converged projection. Spelled through the same mapping the
 *  production check compares against, so the fixture cannot drift from what
 *  a real fold writes. */
function foldedHead(fact: GrantFact): GrantHeadRow {
  return {
    id: fact.grantId,
    principalType: PRINCIPAL_TO_DB[fact.principal.type],
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

      expect(reads).toEqual({ grantHeads: 1, roleHeads: 1, resourceRows: 1 });
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
      // And the drift is repaired for the next pass, as a proper role change
      // stamped with TODAY'S business time — the head's upsert guard refuses
      // an event that is not strictly newer than the row, so a repair pinned
      // to the legacy createdAt would be permanently inert.
      expect(
        sent.some(
          (entry) =>
            entry.kind === "changeGrantRole" &&
            entry.payload.grantId === "binding_1" &&
            entry.payload.to === "member" &&
            entry.payload.occurredAtMs === NOW,
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
    it("restates every fact under the command id the failed attempt used", async () => {
      const attempted: string[] = [];
      let failFirst = true;
      const { migration, sent } = harness(
        { bindings: [binding()], organizationCreatedAtMs: null },
        {
          wrapLedger: (ledger) => ({
            ...ledger,
            attachGrant: async (args) => {
              attempted.push(args.commandId);
              if (failFirst) {
                failFirst = false;
                throw new Error("queue hiccup");
              }
              return ledger.attachGrant(args);
            },
          }),
        },
      );

      await expect(
        migration.migrateTenant({ tenantId: ORG_ID }),
      ).rejects.toThrow("queue hiccup");

      const retry = await migration.migrateTenant({ tenantId: ORG_ID });
      expect(retry.status).toBe("migrated");
      // The retry sends the exact command id the failed attempt tried, so
      // the event store dedupes rather than duplicating.
      expect(attempted).toHaveLength(2);
      expect(attempted[1]).toBe(attempted[0]);
      expect(sent.filter((entry) => entry.kind === "attachGrant")).toHaveLength(
        1,
      );
    });

    /** @scenario "Re-running the migration states the same facts" */
    it("appends a changed legacy row under a NEW command id", async () => {
      // Content is part of the key: identity alone would let the first
      // pass's dedupe silently swallow a row edited between passes.
      const before = harness({
        bindings: [binding({ role: "MEMBER" })],
        organizationCreatedAtMs: null,
      });
      const after = harness({
        bindings: [binding({ role: "ADMIN" })],
        organizationCreatedAtMs: null,
      });

      await before.migration.migrateTenant({ tenantId: ORG_ID });
      await after.migration.migrateTenant({ tenantId: ORG_ID });

      expect(before.sent[0]?.commandId).not.toBe(after.sent[0]?.commandId);
    });

    it("aborts between chunks, parking the organization with sends stopped", async () => {
      const controller = new AbortController();
      const manyBindings = Array.from({ length: 150 }, (_, index) =>
        binding({ id: `binding_${index}` }),
      );
      const { migration, sent } = harness(
        { bindings: manyBindings, organizationCreatedAtMs: null },
        {
          wrapLedger: (ledger) => ({
            ...ledger,
            attachGrant: async (args) => {
              controller.abort();
              return ledger.attachGrant(args);
            },
          }),
        },
      );

      await expect(
        migration.migrateTenant({
          tenantId: ORG_ID,
          signal: controller.signal,
        }),
      ).rejects.toThrow("parked for retry");

      // The first chunk of 100 was already in flight; the second never
      // started — the abort boundary is the chunk.
      expect(sent.filter((entry) => entry.kind === "attachGrant")).toHaveLength(
        100,
      );
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
    it("hands the budget over on every pass, not just the first", async () => {
      const { migration, seeded } = harness({
        shareLinks: [shareLink({ maxViews: 10, viewCount: 3 })],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });
      await migration.migrateTenant({ tenantId: ORG_ID });

      // Legacy keeps counting while the organization is held; re-seeding
      // every pass is what lets the proof heal.
      const seed = [
        { grantId: "share_1", projectId: "project_1", viewCount: 3 },
      ];
      expect(seeded).toEqual([seed, seed]);
    });

    it("refuses to finalize a link whose view budget grew back", async () => {
      const row = shareLink({ maxViews: 10, viewCount: 3 });
      const { migration } = harness({
        shareLinks: [row],
        organizationCreatedAtMs: null,
        resourceRows: [
          {
            grantId: row.id,
            source: "migration",
            token: row.token,
            resourceKind: "TRACE",
            resourceId: row.resourceId,
            projectId: row.projectId,
            principalType: "ANYONE",
            principalId: null,
            expiresAtMs: null,
            maxViews: 10,
            // The head counts MORE spent views than legacy remembers: a
            // budget that grew back, which nothing legitimate produces.
            viewCount: 5,
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
          kind: "resource_changed",
          id: row.id,
          field: "viewCount",
        }),
      );
    });

    it("treats a head behind the legacy view count as lag, not disagreement", async () => {
      // Views land legacy-side between passes and the monotonic seed raises
      // the usage row next pass — outstanding, so the organization heals
      // instead of re-holding forever on an actively-viewed link.
      const row = shareLink({ maxViews: 10, viewCount: 3 });
      const { migration } = harness({
        shareLinks: [row],
        organizationCreatedAtMs: null,
        resourceRows: [
          {
            grantId: row.id,
            source: "migration",
            token: row.token,
            resourceKind: "TRACE",
            resourceId: row.resourceId,
            projectId: row.projectId,
            principalType: "ANYONE",
            principalId: null,
            expiresAtMs: null,
            maxViews: 10,
            viewCount: 1,
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("migrated");
      const report = outcome.report as {
        totalDiffs: number;
        outstandingSample: string[];
      };
      expect(report.totalDiffs).toBe(0);
      expect(report.outstandingSample).toContain(row.id);
    });

    /** @scenario "A row deleted on the legacy side is revoked, not left behind" */
    it("revokes a deleted share link's live resource head", async () => {
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        resourceRows: [
          {
            grantId: "share_orphan",
            source: "migration",
            token: "token_orphan",
            resourceKind: "TRACE",
            resourceId: "trace_1",
            projectId: "project_1",
            principalType: "ANYONE",
            principalId: null,
            expiresAtMs: null,
            maxViews: null,
            viewCount: 0,
          },
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(
        sent.filter(
          (entry) =>
            entry.kind === "revokeGrant" &&
            entry.payload.grantId === "share_orphan",
        ),
      ).toHaveLength(1);
    });

    it("finalizes a link whose head matches field for field", async () => {
      const row = shareLink({ maxViews: 10, viewCount: 3 });
      const { migration } = harness({
        shareLinks: [row],
        organizationCreatedAtMs: null,
        resourceRows: [
          {
            grantId: row.id,
            source: "migration",
            token: row.token,
            resourceKind: "TRACE",
            resourceId: row.resourceId,
            projectId: row.projectId,
            principalType: "ANYONE",
            principalId: null,
            expiresAtMs: null,
            maxViews: 10,
            viewCount: 3,
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("finalized");
    });
  });

  describe("when the heads disagree with legacy in other directions", () => {
    /** @scenario "The check that precedes finalizing is proven, not assumed" */
    it("holds when a stated grant's head is revoked while legacy still holds the row", async () => {
      const row = binding();
      const { migration } = harness({
        bindings: [row],
        organizationCreatedAtMs: null,
        grantHeads: [
          {
            ...foldedHead({
              grantId: row.id,
              principal: { type: "user", id: "user_1" },
              roleKey: "member",
              scope: { type: "PROJECT", id: "project_1" },
              source: "migration",
              occurredAtMs: CREATED,
            }),
            revoked: true,
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("migrated");
      const report = outcome.report as {
        diffs: Array<{ kind: string; id: string }>;
      };
      expect(report.diffs).toContainEqual(
        expect.objectContaining({ kind: "grant_revoked", id: row.id }),
      );
    });

    /** @scenario "The check that precedes finalizing is proven, not assumed" */
    it("repairs a role whose head permissions drifted, and names the drift", async () => {
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        roles: [
          {
            id: "role_1",
            name: "Auditor",
            description: null,
            permissions: ["traces:view", "traces:share"],
            kind: "custom",
            createdAtMs: CREATED,
          },
        ],
        roleHeads: [
          {
            id: "role_1",
            name: "Auditor",
            description: null,
            permissions: ["traces:view"],
            kind: "custom",
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("migrated");
      // Repaired by restating the role WHOLE at today's business time, so
      // the head's strictly-newer guard admits it.
      expect(
        sent.some(
          (entry) =>
            entry.kind === "defineRole" &&
            entry.commandId.startsWith("authz-engine:redefine:role_1:") &&
            (entry.payload.role as RoleFact).permissions.join(",") ===
              "traces:view,traces:share" &&
            (entry.payload.role as RoleFact).occurredAtMs === NOW,
        ),
      ).toBe(true);
      const report = outcome.report as {
        diffs: Array<{ kind: string; field?: string }>;
      };
      expect(report.diffs).toContainEqual(
        expect.objectContaining({ kind: "role_changed", field: "permissions" }),
      );
    });

    it("holds on a renamed role head and names the field", async () => {
      const { migration } = harness({
        organizationCreatedAtMs: null,
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
        roleHeads: [
          {
            id: "role_1",
            name: "Inspector",
            description: null,
            permissions: ["traces:view"],
            kind: "custom",
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(outcome.status).toBe("migrated");
      const report = outcome.report as {
        diffs: Array<{ kind: string; field?: string }>;
      };
      expect(report.diffs).toContainEqual(
        expect.objectContaining({ kind: "role_changed", field: "name" }),
      );
    });

    /** @scenario "A row deleted on the legacy side is revoked, not left behind" */
    it("deletes role heads whose legacy row is gone, whatever their kind", async () => {
      // The migration only runs before an organization finalizes, and until
      // then every role head — system_api_key included — mirrors a legacy
      // CustomRole row; a head with no such row is stale whatever its kind.
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        roleHeads: [
          {
            id: "role_gone",
            name: "Retired",
            description: null,
            permissions: [],
            kind: "custom",
          },
          {
            id: "role_system",
            name: "API key role",
            description: null,
            permissions: [],
            kind: "system_api_key",
          },
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const deletions = sent.filter((entry) => entry.kind === "deleteRole");
      expect(deletions.map((entry) => entry.payload.roleId).sort()).toEqual([
        "role_gone",
        "role_system",
      ]);
    });
  });

  describe("when legacy rows cannot be expressed as grants", () => {
    /** @scenario "Every legacy table is a source of facts" */
    it("skips a binding naming no principal, on both the state and the check side", async () => {
      const { migration, sent } = harness({
        bindings: [binding({ userId: null, groupId: null, apiKeyId: null })],
        organizationCreatedAtMs: null,
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(sent.filter((entry) => entry.kind === "attachGrant")).toHaveLength(
        0,
      );
      // Nothing stated means nothing outstanding: the row holds nothing up.
      expect(outcome.status).toBe("finalized");
    });

    /** @scenario "Every legacy table is a source of facts" */
    it("leaves an earlier import of a principal-less binding alone, and finalizes anyway", async () => {
      const retained = binding({
        id: "binding_retained",
        userId: null,
        groupId: null,
        apiKeyId: null,
      });
      const { migration, sent } = harness({
        bindings: [retained],
        organizationCreatedAtMs: null,
        // A head an earlier import wrote for the row this pass declines to
        // express. Legacy still HAS the row, so the sweep must not revoke
        // it — and the check must not count it outstanding either, because
        // no later pass could ever clear that.
        grantHeads: [
          {
            id: retained.id,
            principalType: "USER",
            principalId: null,
            roleKey: "member",
            legacyRole: null,
            source: "genesis-import",
            scopeType: "PROJECT",
            scopeId: "project_1",
            revoked: false,
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: ORG_ID });

      expect(sent.filter((entry) => entry.kind === "revokeGrant")).toEqual([]);
      expect(outcome.status).toBe("finalized");
    });

    /** @scenario "Team membership is stated directly, not promoted first" */
    it("never states a CUSTOM membership row: the legacy fallback denies that shape", async () => {
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        teamRows: [
          {
            userId: "user_1",
            teamId: "team_1",
            role: "CUSTOM",
            customRoleId: "role_1",
            createdAtMs: CREATED,
          },
          {
            userId: "user_2",
            teamId: "team_1",
            role: "CUSTOM",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      expect(attachedFacts(sent)).toHaveLength(0);
    });

    /** @scenario "Team membership is stated directly, not promoted first" */
    it("suppresses a membership beside a binding of ANY role, matching the resolver", async () => {
      // Legacy suppresses its fallback on any binding at the scopes in
      // play, whatever role it carries — keying the suppression on role
      // stated an extra admin grant legacy never answers.
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        teamRows: [
          {
            userId: "user_1",
            teamId: "team_1",
            role: "ADMIN",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
        bindings: [
          binding({
            id: "binding_team",
            scopeType: "TEAM",
            scopeId: "team_1",
            role: "VIEWER",
          }),
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const teamFacts = attachedFacts(sent).filter(
        (fact) => fact.scope.type === "TEAM",
      );
      expect(teamFacts.map((fact) => fact.grantId)).toEqual(["binding_team"]);
    });

    /** @scenario "Team membership is stated directly, not promoted first" */
    it("counts a binding held through a group as suppressing too", async () => {
      const { migration, sent } = harness({
        organizationCreatedAtMs: null,
        teamRows: [
          {
            userId: "user_1",
            teamId: "team_1",
            role: "MEMBER",
            customRoleId: null,
            createdAtMs: CREATED,
          },
        ],
        groupMemberships: [{ userId: "user_1", groupId: "group_1" }],
        bindings: [
          binding({
            id: "binding_group",
            userId: null,
            groupId: "group_1",
            scopeType: "TEAM",
            scopeId: "team_1",
            role: "VIEWER",
          }),
        ],
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const teamFacts = attachedFacts(sent).filter(
        (fact) => fact.scope.type === "TEAM" && fact.principal.type === "user",
      );
      expect(teamFacts).toHaveLength(0);
    });

    /** @scenario "The organization member floor is stated once" */
    it("does not double-grant an ADMIN who already holds a binding", async () => {
      const { migration, sent } = harness({
        members: [member("user_admin", "ADMIN")],
        bindings: [binding({ userId: "user_admin" })],
        organizationCreatedAtMs: null,
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      const facts = attachedFacts(sent);
      expect(facts.some((fact) => fact.roleKey === "legacy-admin")).toBe(false);
    });

    /** @scenario "The organization member floor is stated once" */
    it("reads a group-held binding as a binding, the way the legacy resolver does", async () => {
      const { migration, sent } = harness({
        members: [member("user_admin", "ADMIN")],
        bindings: [binding({ userId: null, groupId: "group_1" })],
        groupMemberships: [{ userId: "user_admin", groupId: "group_1" }],
        organizationCreatedAtMs: null,
      });

      await migration.migrateTenant({ tenantId: ORG_ID });

      // The admin's only binding is held through a group. The resolver
      // counts it, so the fallback is suppressed here too — the same
      // predicate the team-membership suppression uses.
      const facts = attachedFacts(sent);
      expect(facts.some((fact) => fact.roleKey === "legacy-admin")).toBe(false);
    });
  });
});
