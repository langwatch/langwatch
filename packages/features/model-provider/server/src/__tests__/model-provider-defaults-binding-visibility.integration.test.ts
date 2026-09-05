/**
 * @vitest-environment node
 *
 * @see specs/model-providers/role-based-default-models.feature
 *
 * Real-Postgres coverage for Default Models read visibility when a member's
 * project access comes from ROLE BINDINGS only (an ORGANIZATION-scope MEMBER
 * binding plus a TEAM-scope MEMBER binding, no legacy TeamUser row).
 *
 * On main this guarded `batchScopePermissions`, a hand-rolled batch loader
 * that fetched role bindings only for the scope ids it was directly asked
 * about — so a project-permission batch never loaded the TEAM-scoped
 * bindings a project inherits from, and a role-binding-only member saw no
 * default models. That loader is gone: `ModelProviderDefaultsService.
 * getSnapshot` now asks `ModelProviderAuthorizationService.canRead` once per
 * config row, which delegates straight to `AuthzService.getDecision` — the
 * real permission engine, with no scope-id batching to have a blind spot in.
 *
 * The authz decision here is computed from real Postgres role-binding rows
 * (including the project -> team lookup a TEAM-scope binding needs to cover
 * a project), not echoed, so this still proves the visibility this scenario
 * describes rather than a mock's own bookkeeping.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzService } from "@langwatch/authz-contract";
import { ModelProviderDefaultsService } from "../services/model-provider-defaults.service";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service";
import { ModelProviderScopeService } from "../services/model-provider-scope.service";
import { PrismaModelDefaultRepository } from "../repositories/prisma/prisma.model-default.repository";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  PrismaProjects,
  TestModelProviderCatalog,
  createTestPrismaClient,
  idService,
  testNamespace,
} from "./support/model-provider-integration.support";

describe.skipIf(!DB_URL)(
  "Default Models visibility for role-binding-only members (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const ns = testNamespace("mdcfg-vis");

    let organizationId: string;
    let teamId: string;
    let otherTeamId: string;
    let projectAId: string;
    let projectBId: string;
    let otherTeamProjectId: string;
    let bindingMemberUserId: string;
    const configIds: string[] = [];

    /** Real per-row role bindings, resolved with the project -> team a TEAM binding covers. */
    function bindingComputingAuthz(): AuthzService {
      return {
        getDecision: async (input: {
          userId: string;
          permission: string;
          scope: { tier: string; id: string };
        }) => {
          let scopeIds = [input.scope.id];
          if (input.scope.tier === "project") {
            const project = await prisma.project.findUnique({
              where: { id: input.scope.id },
              select: { teamId: true, team: { select: { organizationId: true } } },
            });
            if (project) scopeIds = [input.scope.id, project.teamId, project.team.organizationId];
          }
          const bindings = await prisma.roleBinding.findMany({
            where: { organizationId, userId: input.userId, scopeId: { in: scopeIds } },
          });
          return { permitted: bindings.length > 0 };
        },
      } as unknown as AuthzService;
    }

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Binding Visibility Org ${ns}`, slug: `--test-${ns}` },
      });
      organizationId = organization.id;
      const team = await prisma.team.create({
        data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
      });
      teamId = team.id;
      const otherTeam = await prisma.team.create({
        data: { name: `Other Team ${ns}`, slug: `--team-b-${ns}`, organizationId },
      });
      otherTeamId = otherTeam.id;

      const mkProject = (slug: string, forTeamId: string) =>
        prisma.project.create({
          data: {
            name: `Project ${slug} ${ns}`,
            slug: `--proj-${slug}-${ns}`,
            teamId: forTeamId,
            language: "en",
            framework: "test",
            apiKey: `test-key-${slug}-${ns}`,
          },
        });
      projectAId = (await mkProject("a", teamId)).id;
      projectBId = (await mkProject("b", teamId)).id;
      otherTeamProjectId = (await mkProject("c", otherTeamId)).id;

      const member = await prisma.user.create({
        data: { name: "Binding Member", email: `binding-member-${ns}@example.com` },
      });
      bindingMemberUserId = member.id;
      await prisma.organizationUser.create({
        data: { userId: member.id, organizationId, role: "MEMBER" },
      });
      await prisma.roleBinding.createMany({
        data: [
          {
            organizationId,
            userId: member.id,
            role: "MEMBER",
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
          },
          { organizationId, userId: member.id, role: "MEMBER", scopeType: "TEAM", scopeId: teamId },
        ],
      });

      const defaultsRepo = PrismaModelDefaultRepository.create(prisma);
      for (const projectId of [projectAId, projectBId]) {
        const created = await defaultsRepo.save({
          id: idService.generate({ type: "default" }),
          organizationId,
          config: { FAST: "azure/gpt-5.4-mini" },
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          authorId: null,
        } as never);
        configIds.push(created.id);
      }
    });

    afterAll(async () => {
      await prisma.modelDefaultConfigScope.deleteMany({ where: { configId: { in: configIds } } });
      await prisma.modelDefaultConfig.deleteMany({ where: { organizationId } });
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { teamId } });
      await prisma.project.deleteMany({ where: { teamId: otherTeamId } });
      await prisma.team.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: bindingMemberUserId } });
      await prisma.$disconnect();
    });

    describe("when the member's project access comes from a TEAM-scope binding", () => {
      /** @scenario Default Models list is visible to members whose access comes from role bindings */
      it("lists the project-scoped configs in the Default Models snapshot", async () => {
        const service = ModelProviderDefaultsService.create({
          defaults: PrismaModelDefaultRepository.create(prisma),
          providers: PrismaModelProviderRepository.create(
            prisma,
            new IdentityModelProviderCredentialCodec(),
          ),
          catalog: new TestModelProviderCatalog(),
          authorization: ModelProviderAuthorizationService.create(bindingComputingAuthz()),
          scopes: ModelProviderScopeService.create({
            projects: {
              tryGetWithTeam: (id: string) => new PrismaProjects(prisma).tryGetWithTeam(id),
              getWithTeam: (id: string) => new PrismaProjects(prisma).getWithTeam(id),
              listIdsByOrganization: async (input: { organizationId: string }) => {
                const rows = await prisma.project.findMany({
                  where: { team: { organizationId: input.organizationId } },
                  select: { id: true },
                });
                return rows.map((r) => r.id);
              },
              listNamesByIds: async (input: { projectIds: string[] }) => {
                const rows = await prisma.project.findMany({
                  where: { id: { in: input.projectIds } },
                  select: { id: true, name: true, teamId: true },
                });
                return rows;
              },
            } as never,
            organizations: {
              getBillingProfile: async (input: { organizationId: string }) => {
                const org = await prisma.organization.findUniqueOrThrow({
                  where: { id: input.organizationId },
                });
                return { id: org.id, name: org.name };
              },
              listTeams: async () => ({ data: [], pagination: { total: 0 } }),
            } as never,
          }),
        });

        const snapshot = await service.getSnapshot({
          projectId: projectAId,
          actorId: bindingMemberUserId,
        } as never);

        const scopedProjectIds = snapshot.configs.flatMap((c) => c.scopes.map((s) => s.id));
        expect(scopedProjectIds).toContain(projectAId);
        expect(scopedProjectIds).toContain(projectBId);
        expect(scopedProjectIds).not.toContain(otherTeamProjectId);
      });
    });
  },
);
