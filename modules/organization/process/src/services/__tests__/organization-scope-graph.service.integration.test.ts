import type { AuthzApi, AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { ScopeGraphOrganization } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
/**
 * @vitest-environment node
 * @see modules/organization/specs/scope-graph.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaScopeGraphRepository } from "../../repositories/prisma/prisma.scope-graph.repository.ts";
import { OrganizationScopeGraphService } from "../organization-scope-graph.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

function graphOf(graph: ScopeGraphOrganization[]): ScopeGraphOrganization {
  const [organization] = graph;
  if (!organization) throw new Error("the caller's organization did not arrive");
  return organization;
}

describe.skipIf(!DB_URL)("OrganizationScopeGraphService over Postgres", () => {
  const ns = `scope-graph-${nanoid(8)}`;
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient;
  let service: OrganizationScopeGraphService;
  const ids = { organization: "", caller: "", colleague: "", admin: "" };
  const teamIds: string[] = [];
  const team: Record<string, string> = {};
  const project: Record<string, string> = {};

  beforeAll(async () => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:scope-graph"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client;

    const organization = await prisma.organization.create({
      data: { name: `Org ${ns}`, slug: `org-${ns}` },
    });
    ids.organization = organization.id;
    const caller = await prisma.user.create({ data: { email: `caller-${ns}@example.com` } });
    const colleague = await prisma.user.create({ data: { email: `colleague-${ns}@example.com` } });
    ids.caller = caller.id;
    ids.colleague = colleague.id;
    const admin = await prisma.user.create({ data: { email: `admin-${ns}@example.com` } });
    ids.admin = admin.id;
    await prisma.organizationUser.createMany({
      data: [
        { userId: caller.id, organizationId: organization.id, role: "MEMBER" },
        { userId: colleague.id, organizationId: organization.id, role: "MEMBER" },
        { userId: admin.id, organizationId: organization.id, role: "ADMIN" },
      ],
    });

    const teams = [
      { key: "own", isPersonal: false, ownerUserId: null, archivedAt: null },
      { key: "hidden", isPersonal: false, ownerUserId: null, archivedAt: null },
      { key: "bound", isPersonal: false, ownerUserId: null, archivedAt: null },
      { key: "archived", isPersonal: false, ownerUserId: null, archivedAt: new Date() },
      { key: "colleague-personal", isPersonal: true, ownerUserId: colleague.id, archivedAt: null },
    ];
    for (const { key, ...rest } of teams) {
      const created = await prisma.team.create({
        data: {
          name: `${key} ${ns}`,
          slug: `${key}-${ns}`,
          organizationId: organization.id,
          ...rest,
        },
      });
      team[key] = created.id;
      teamIds.push(created.id);
    }
    await prisma.teamUser.createMany({
      data: [
        { userId: caller.id, teamId: team.own ?? "", role: "MEMBER" },
        { userId: caller.id, teamId: team.archived ?? "", role: "MEMBER" },
        { userId: colleague.id, teamId: team["colleague-personal"] ?? "", role: "ADMIN" },
      ],
    });

    const projects = [
      { key: "app", teamKey: "own", kind: "application", archivedAt: null },
      { key: "archived", teamKey: "own", kind: "application", archivedAt: new Date() },
      { key: "governance", teamKey: "own", kind: "internal_governance", archivedAt: null },
      { key: "bound", teamKey: "bound", kind: "application", archivedAt: null },
      { key: "hidden", teamKey: "hidden", kind: "application", archivedAt: null },
    ];
    for (const { key, teamKey, ...rest } of projects) {
      const created = await prisma.project.create({
        data: {
          name: `${key} ${ns}`,
          slug: `${key}-${ns}`,
          apiKey: `key-${key}-${ns}`,
          teamId: team[teamKey] ?? "",
          language: "python",
          framework: "openai",
          ...rest,
        },
      });
      project[key] = created.id;
    }

    const bindings: AuthzBindingForSynthesis[] = [
      {
        organizationId: organization.id,
        scopeType: "TEAM",
        scopeId: team.bound ?? "",
        role: "MEMBER",
        customRoleId: null,
        customRole: null,
      },
    ];
    service = OrganizationScopeGraphService.create({
      reader: PrismaScopeGraphRepository.create(prisma),
      permissions: createApiFixture<AuthzApi>({ listBindingsForSynthesis: async () => bindings }),
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await prisma.project.deleteMany({ where: { id: { in: Object.values(project) } } });
    await prisma.teamUser.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ids.organization } });
    await prisma.organization.delete({ where: { id: ids.organization } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.caller, ids.colleague, ids.admin] } } });
    await prisma.$disconnect();
  });

  describe("when a member asks for their scope graph", () => {
    /** @scenario "A member receives only the teams they can open" */
    it("returns their own team and the team a binding reaches, nothing else", async () => {
      const organization = graphOf(await service.getScopeGraph({ id: ids.caller }));

      expect(organization.members).toEqual([{ role: "MEMBER" }]);
      expect(organization.teams.map((each) => each.id)).toEqual([team.own, team.bound]);
      expect(organization.teams.map((each) => each.personalOf)).toEqual([null, null]);
    });

    /** @scenario "A team reached through a binding carries the caller's membership" */
    it("synthesises the caller's membership on the team a binding reaches", async () => {
      const organization = graphOf(await service.getScopeGraph({ id: ids.caller }));
      const bound = organization.teams.find((each) => each.id === team.bound);

      expect(bound?.members).toEqual([{ userId: ids.caller }]);
      expect(bound?.projects.map((each) => each.id)).toEqual([project.bound]);
    });

    /** @scenario "Archived and internal-governance projects stay out of the graph" */
    /** @scenario The hidden Governance Project never appears in the ProjectSelector dropdown */
    /** @scenario The hidden Governance Project never appears in RBAC role binding pickers */
    /** @scenario The hidden Governance Project never appears in any other user-visible Project surface */
    it("leaves out archived and internal-governance projects", async () => {
      const organization = graphOf(await service.getScopeGraph({ id: ids.caller }));
      const own = organization.teams.find((each) => each.id === team.own);

      expect(own?.projects.map((each) => each.id)).toEqual([project.app]);
    });

    /** @scenario "Another member's personal team stays out of the graph" */
    it("leaves out another member's personal team", async () => {
      const organization = graphOf(await service.getScopeGraph({ id: ids.caller }));

      expect(organization.teams.some((each) => each.isPersonal)).toBe(false);
    });
  });

  describe("when an organization administrator asks for their scope graph", () => {
    /** @scenario "An admin sees a member's personal team marked as theirs" */
    it("includes a member's personal team marked with its owner", async () => {
      const organization = graphOf(await service.getScopeGraph({ id: ids.admin }));
      const personal = organization.teams.find((each) => each.id === team["colleague-personal"]);

      expect(personal?.personalOf).toBe(ids.colleague);
      expect(organization.teams.find((each) => each.id === team.own)?.personalOf).toBeNull();
    });
  });

  describe("when a project the caller can see is renamed", () => {
    /** @scenario "A rename answers the new name" */
    it("answers a different graph carrying the new name", async () => {
      const before = await service.getScopeGraph({ id: ids.caller });

      await prisma.project.update({
        where: { id: project.app ?? "" },
        data: { name: `renamed ${ns}` },
      });
      const after = await service.getScopeGraph({ id: ids.caller });

      expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
      const own = graphOf(after).teams.find((each) => each.id === team.own);
      expect(own?.projects[0]?.name).toBe(`renamed ${ns}`);
    });
  });
});
