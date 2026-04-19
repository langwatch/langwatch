/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for ModelProvider scope authz.
 *
 * The unit tests in `modelProvider.authz.unit.test.ts` mock the rbac
 * helpers and prove the orchestration (fail-closed loop, NOT_FOUND vs
 * FORBIDDEN) is correct in isolation. This file stands up actual org /
 * team / project rows with organization and team-user bindings and
 * exercises `ModelProviderService` end-to-end to prove the *composed*
 * path still holds: seed role → seed MP → call service → assert.
 *
 * Requires: PostgreSQL (Prisma). Skipped in the Testcontainers-only
 * ClickHouse suite.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../db";
import { ModelProviderService } from "../modelProvider.service";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(isTestcontainersOnly || !hasCredentialsSecret)(
  "ModelProviderService scope authz (real DB)",
  () => {
    const ns = `mp-authz-${nanoid(8)}`;

    let organizationId: string;
    let teamAId: string;
    let teamBId: string;
    let projectAId: string;
    let projectBId: string;

    let orgAdminUserId: string;
    let teamAAdminUserId: string;
    let teamAMemberUserId: string;
    let unrelatedUserId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: `Authz Org ${ns}`,
          slug: `--test-${ns}`,
        },
      });
      organizationId = organization.id;

      const teamA = await prisma.team.create({
        data: {
          name: `Team A ${ns}`,
          slug: `--team-a-${ns}`,
          organizationId,
        },
      });
      teamAId = teamA.id;

      const teamB = await prisma.team.create({
        data: {
          name: `Team B ${ns}`,
          slug: `--team-b-${ns}`,
          organizationId,
        },
      });
      teamBId = teamB.id;

      const projectA = await prisma.project.create({
        data: {
          name: `Project A ${ns}`,
          slug: `--proj-a-${ns}`,
          teamId: teamA.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-a-${ns}`,
        },
      });
      projectAId = projectA.id;

      const projectB = await prisma.project.create({
        data: {
          name: `Project B ${ns}`,
          slug: `--proj-b-${ns}`,
          teamId: teamB.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-b-${ns}`,
        },
      });
      projectBId = projectB.id;

      // Org-level admin: OrganizationUser ADMIN alone is not enough for the
      // rbac helpers to grant org:manage — the checkPermissionFromBindings
      // path needs a RoleBinding (or a TeamUser fallback). We add an
      // ORGANIZATION-scoped RoleBinding with role=ADMIN so this user
      // exercises the intended "full org admin" code path.
      const orgAdmin = await prisma.user.create({
        data: { name: "Org Admin", email: `org-admin-${ns}@example.com` },
      });
      orgAdminUserId = orgAdmin.id;
      await prisma.organizationUser.create({
        data: {
          userId: orgAdmin.id,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: orgAdmin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });

      // Team A admin: org MEMBER + TeamUser ADMIN on A only. Should pass
      // team:manage and project:manage for A, but NOT organization:manage
      // or team:manage for B.
      const teamAAdmin = await prisma.user.create({
        data: { name: "Team A Admin", email: `team-a-admin-${ns}@example.com` },
      });
      teamAAdminUserId = teamAAdmin.id;
      await prisma.organizationUser.create({
        data: {
          userId: teamAAdmin.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      await prisma.teamUser.create({
        data: {
          userId: teamAAdmin.id,
          teamId: teamA.id,
          role: TeamUserRole.ADMIN,
        },
      });

      // Team A member: org MEMBER + TeamUser MEMBER on A. No :manage.
      // Also seeded with an ORG-scoped RoleBinding at role=MEMBER so the
      // scope-aware read gate recognises them as an org viewer (required
      // for `canReadAnyScope` to return true on org-scoped rows).
      const teamAMember = await prisma.user.create({
        data: { name: "Team A Member", email: `team-a-member-${ns}@example.com` },
      });
      teamAMemberUserId = teamAMember.id;
      await prisma.organizationUser.create({
        data: {
          userId: teamAMember.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });
      await prisma.teamUser.create({
        data: {
          userId: teamAMember.id,
          teamId: teamA.id,
          role: TeamUserRole.MEMBER,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: teamAMember.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });

      // Unrelated user: no membership anywhere in this org.
      const unrelated = await prisma.user.create({
        data: { name: "Unrelated", email: `unrelated-${ns}@example.com` },
      });
      unrelatedUserId = unrelated.id;
    });

    afterAll(async () => {
      // Order matters: providers (scopes cascade via onDelete: Cascade)
      // → teamUser/orgUser → team/project → user → org.
      // Multi-tenancy protection requires projectId in the WHERE clause,
      // so we scope by projectId (safer than the slug-pattern anyway).
      const projectIds = [projectAId, projectBId].filter(Boolean);
      await prisma.roleBinding
        .deleteMany({ where: { organizationId } })
        .catch(() => {});
      await prisma.modelProvider
        .deleteMany({ where: { projectId: { in: projectIds } } })
        .catch(() => {});
      await prisma.teamUser
        .deleteMany({ where: { team: { slug: { startsWith: `--team-` } } } })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organization: { slug: `--test-${ns}` } } })
        .catch(() => {});
      await prisma.project
        .deleteMany({ where: { slug: { startsWith: `--proj-` } } })
        .catch(() => {});
      await prisma.team
        .deleteMany({ where: { slug: { startsWith: `--team-` } } })
        .catch(() => {});
      await prisma.organization
        .deleteMany({ where: { slug: `--test-${ns}` } })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: {
            email: {
              in: [
                `org-admin-${ns}@example.com`,
                `team-a-admin-${ns}@example.com`,
                `team-a-member-${ns}@example.com`,
                `unrelated-${ns}@example.com`,
              ],
            },
          },
        })
        .catch(() => {});
    });

    function ctxFor(userId: string) {
      return {
        prisma,
        session: {
          user: { id: userId },
          expires: "1",
        } as any,
      };
    }

    function service() {
      return ModelProviderService.create(prisma);
    }

    // =========================================================================
    // Fail-closed on the WRITE path (updateModelProvider)
    // =========================================================================

    describe("given an ORGANIZATION-scoped MP write", () => {
      describe("when the caller is an org admin", () => {
        it("creates the row", async () => {
          const result = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "openai",
              enabled: true,
              customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
              scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
            },
            ctxFor(orgAdminUserId),
          );
          expect(result).toBeDefined();
          // Read back directly via prisma to check the scope row landed.
          const stored = await prisma.modelProvider.findFirst({
            where: { id: result.id, projectId: projectAId },
            include: { scopes: true },
          });
          const scopes = stored?.scopes ?? [];
          expect(scopes).toHaveLength(1);
          expect(scopes[0]).toMatchObject({
            scopeType: "ORGANIZATION",
            scopeId: organizationId,
          });
        });
      });

      describe("when the caller is only a team admin (not org admin)", () => {
        it("rejects with FORBIDDEN and does not persist", async () => {
          const before = await prisma.modelProvider.count({
            where: { projectId: projectAId, provider: "anthropic" },
          });
          await expect(
            service().updateModelProvider(
              {
                projectId: projectAId,
                provider: "anthropic",
                enabled: true,
                customKeys: { ANTHROPIC_API_KEY: `sk-ant-${ns}` },
                scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
              },
              ctxFor(teamAAdminUserId),
            ),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: expect.stringContaining("organization:manage"),
          });
          const after = await prisma.modelProvider.count({
            where: { projectId: projectAId, provider: "anthropic" },
          });
          expect(after).toBe(before);
        });
      });

      describe("when the caller is an ordinary team member", () => {
        it("rejects with FORBIDDEN", async () => {
          await expect(
            service().updateModelProvider(
              {
                projectId: projectAId,
                provider: "gemini",
                enabled: true,
                customKeys: { GEMINI_API_KEY: `sk-gem-${ns}` },
                scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
              },
              ctxFor(teamAMemberUserId),
            ),
          ).rejects.toBeInstanceOf(TRPCError);
        });
      });
    });

    describe("given a TEAM-scoped MP write", () => {
      describe("when the caller is team admin for the target team", () => {
        it("creates the row", async () => {
          const result = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "groq",
              enabled: true,
              customKeys: { GROQ_API_KEY: `sk-groq-${ns}` },
              scopes: [{ scopeType: "TEAM", scopeId: teamAId }],
            },
            ctxFor(teamAAdminUserId),
          );
          expect(result).toBeDefined();
          const stored = await prisma.modelProvider.findFirst({
            where: { id: result.id, projectId: projectAId },
            include: { scopes: true },
          });
          const scopes = stored?.scopes ?? [];
          expect(scopes).toHaveLength(1);
          expect(scopes[0]).toMatchObject({
            scopeType: "TEAM",
            scopeId: teamAId,
          });
        });
      });

      describe("when the caller is team admin for a DIFFERENT team", () => {
        it("rejects with FORBIDDEN", async () => {
          await expect(
            service().updateModelProvider(
              {
                projectId: projectBId,
                provider: "xai",
                enabled: true,
                customKeys: { XAI_API_KEY: `sk-xai-${ns}` },
                scopes: [{ scopeType: "TEAM", scopeId: teamBId }],
              },
              ctxFor(teamAAdminUserId),
            ),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });
        });
      });
    });

    // =========================================================================
    // Multi-scope atomicity: every entry must pass or the whole write aborts
    // =========================================================================

    describe("given a multi-scope write (ORG + TEAM)", () => {
      describe("when the caller can manage ONLY the team (not the org)", () => {
        it("rejects the entire mutation with no partial persistence", async () => {
          const before = await prisma.modelProvider.count({
            where: { projectId: projectAId, provider: "deepseek" },
          });
          await expect(
            service().updateModelProvider(
              {
                projectId: projectAId,
                provider: "deepseek",
                enabled: true,
                customKeys: { DEEPSEEK_API_KEY: `sk-ds-${ns}` },
                scopes: [
                  { scopeType: "TEAM", scopeId: teamAId }, // caller can manage
                  { scopeType: "ORGANIZATION", scopeId: organizationId }, // caller cannot
                ],
              },
              ctxFor(teamAAdminUserId),
            ),
          ).rejects.toMatchObject({ code: "FORBIDDEN" });

          const after = await prisma.modelProvider.count({
            where: { projectId: projectAId, provider: "deepseek" },
          });
          expect(after).toBe(before);
        });
      });

      describe("when the caller is an org admin (can manage both)", () => {
        it("persists every scope entry", async () => {
          const result = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "cerebras",
              enabled: true,
              customKeys: { CEREBRAS_API_KEY: `sk-cer-${ns}` },
              scopes: [
                { scopeType: "ORGANIZATION", scopeId: organizationId },
                { scopeType: "TEAM", scopeId: teamAId },
                { scopeType: "PROJECT", scopeId: projectAId },
              ],
            },
            ctxFor(orgAdminUserId),
          );
          const stored = await prisma.modelProvider.findFirst({
            where: { id: result.id, projectId: projectAId },
            include: { scopes: true },
          });
          const scopes = stored?.scopes ?? [];
          expect(scopes).toHaveLength(3);
          const kinds = scopes.map((s) => s.scopeType).sort();
          expect(kinds).toEqual(["ORGANIZATION", "PROJECT", "TEAM"]);
        });
      });
    });

    // =========================================================================
    // Read gate: NOT_FOUND (not FORBIDDEN) for unreadable scopes
    // =========================================================================

    describe("given an ORG-scoped MP that the caller cannot see", () => {
      describe("when an unrelated user calls getById", () => {
        it("surfaces NOT_FOUND to prevent id enumeration across tenants", async () => {
          const mp = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "bedrock",
              enabled: true,
              customKeys: { AWS_ACCESS_KEY_ID: `ak-${ns}` },
              scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
            },
            ctxFor(orgAdminUserId),
          );

          await expect(
            service().getById(mp.id, projectAId, ctxFor(unrelatedUserId)),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });
        });
      });

      describe("when a user with org membership reads", () => {
        it("returns the row", async () => {
          const mp = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "vertex_ai",
              enabled: true,
              customKeys: {
                GOOGLE_APPLICATION_CREDENTIALS: `{"stub":"${ns}"}`,
                VERTEXAI_PROJECT: "stub-proj",
                VERTEXAI_LOCATION: "us-central1",
              },
              scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
            },
            ctxFor(orgAdminUserId),
          );
          const read = await service().getById(
            mp.id,
            projectAId,
            ctxFor(teamAMemberUserId),
          );
          expect(read.id).toBe(mp.id);
        });
      });
    });

    // =========================================================================
    // Delete gate: must hold manage on every persisted scope
    // =========================================================================

    describe("given a TEAM-scoped MP exists", () => {
      describe("when a team admin deletes it", () => {
        it("removes the row and its scopes", async () => {
          const mp = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "custom",
              enabled: true,
              customKeys: { CUSTOM_BASE_URL: `https://custom-${ns}.test/v1` },
              scopes: [{ scopeType: "TEAM", scopeId: teamAId }],
            },
            ctxFor(teamAAdminUserId),
          );

          await service().deleteModelProvider(
            { id: mp.id, projectId: projectAId, provider: "custom" },
            ctxFor(teamAAdminUserId),
          );

          const remaining = await prisma.modelProvider.findFirst({
            where: { id: mp.id, projectId: projectAId },
            include: { scopes: true },
          });
          expect(remaining).toBeNull();
        });
      });

      describe("when a team-admin from a different team tries to delete", () => {
        it("rejects with FORBIDDEN", async () => {
          const mp = await service().updateModelProvider(
            {
              projectId: projectAId,
              provider: "azure_safety",
              enabled: true,
              customKeys: {
                AZURE_CONTENT_SAFETY_ENDPOINT: "https://stub.test",
                AZURE_CONTENT_SAFETY_KEY: `key-${ns}`,
              },
              scopes: [{ scopeType: "TEAM", scopeId: teamAId }],
            },
            ctxFor(teamAAdminUserId),
          );

          // Seed a team admin for team B to prove the cross-team rejection.
          const teamBAdmin = await prisma.user.create({
            data: {
              name: "Team B Admin",
              email: `team-b-admin-${ns}@example.com`,
            },
          });
          await prisma.organizationUser.create({
            data: {
              userId: teamBAdmin.id,
              organizationId,
              role: OrganizationUserRole.MEMBER,
            },
          });
          await prisma.teamUser.create({
            data: {
              userId: teamBAdmin.id,
              teamId: teamBId,
              role: TeamUserRole.ADMIN,
            },
          });

          try {
            await expect(
              service().deleteModelProvider(
                { id: mp.id, projectId: projectAId, provider: "azure_safety" },
                ctxFor(teamBAdmin.id),
              ),
            ).rejects.toMatchObject({ code: "FORBIDDEN" });

            // Row still present
            const stillThere = await prisma.modelProvider.findFirst({
              where: { id: mp.id, projectId: projectAId },
            });
            expect(stillThere).not.toBeNull();
          } finally {
            await prisma.teamUser
              .deleteMany({ where: { userId: teamBAdmin.id } })
              .catch(() => {});
            await prisma.organizationUser
              .deleteMany({ where: { userId: teamBAdmin.id } })
              .catch(() => {});
            await prisma.user
              .deleteMany({ where: { id: teamBAdmin.id } })
              .catch(() => {});
          }
        });
      });
    });
  },
);
