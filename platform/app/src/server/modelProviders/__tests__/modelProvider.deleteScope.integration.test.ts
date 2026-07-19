/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for scope-aware provider deletion.
 *
 * The settings list surfaces credentials granted at the organization, team,
 * or a sibling project. Deletion used to look the row up with a PROJECT-only
 * scope filter, so an org-scoped provider (shown in the list with an org
 * scope chip) 404'd with "Model provider not found for this project". The
 * delete path now anchors the lookup to the caller's organization and hard-
 * deletes the row + its encrypted credentials, gated by the existing
 * manage-all-scopes authz.
 *
 * Requires: PostgreSQL (Prisma) + CREDENTIALS_SECRET (rows store encrypted
 * keys). Skipped in the Testcontainers-only ClickHouse suite.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../db";
import { ModelProviderRepository } from "../modelProvider.repository";
import { ModelProviderService } from "../modelProvider.service";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(isTestcontainersOnly || !hasCredentialsSecret)(
  "ModelProviderService scope-aware deletion (real DB)",
  () => {
    const ns = `mp-del-${nanoid(8)}`;

    let orgId: string;
    let otherOrgId: string;
    let teamId: string;
    let otherTeamId: string;
    let projectAId: string;
    let siblingProjectId: string;
    let otherProjectId: string;
    let orgAdminUserId: string;

    const repo = () => new ModelProviderRepository(prisma);
    const service = () => ModelProviderService.create(prisma);

    function ctxFor(userId: string) {
      return {
        prisma,
        session: { user: { id: userId }, expires: "1" } as any,
      };
    }

    beforeAll(async () => {
      const org = await prisma.organization.create({
        data: { name: `Del Org ${ns}`, slug: `--del-${ns}` },
      });
      orgId = org.id;

      const otherOrg = await prisma.organization.create({
        data: { name: `Del Other Org ${ns}`, slug: `--del-other-${ns}` },
      });
      otherOrgId = otherOrg.id;

      const team = await prisma.team.create({
        data: { name: `Del Team ${ns}`, slug: `--del-team-${ns}`, organizationId: orgId },
      });
      teamId = team.id;

      const otherTeam = await prisma.team.create({
        data: {
          name: `Del Other Team ${ns}`,
          slug: `--del-other-team-${ns}`,
          organizationId: otherOrgId,
        },
      });
      otherTeamId = otherTeam.id;

      const projectA = await prisma.project.create({
        data: {
          name: `Del Proj A ${ns}`,
          slug: `--del-proj-a-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `del-key-a-${ns}`,
        },
      });
      projectAId = projectA.id;

      const siblingProject = await prisma.project.create({
        data: {
          name: `Del Proj Sibling ${ns}`,
          slug: `--del-proj-sib-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `del-key-sib-${ns}`,
        },
      });
      siblingProjectId = siblingProject.id;

      const otherProject = await prisma.project.create({
        data: {
          name: `Del Proj Other ${ns}`,
          slug: `--del-proj-other-${ns}`,
          teamId: otherTeamId,
          language: "typescript",
          framework: "other",
          apiKey: `del-key-other-${ns}`,
        },
      });
      otherProjectId = otherProject.id;

      const orgAdmin = await prisma.user.create({
        data: { name: "Del Org Admin", email: `del-org-admin-${ns}@example.com` },
      });
      orgAdminUserId = orgAdmin.id;
      await prisma.organizationUser.create({
        data: { userId: orgAdmin.id, organizationId: orgId, role: OrganizationUserRole.ADMIN },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: orgId,
          userId: orgAdmin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: orgId,
        },
      });
    });

    afterAll(async () => {
      const projectIds = [projectAId, siblingProjectId, otherProjectId].filter(Boolean);
      await prisma.modelProvider
        .deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
        .catch(() => {});
      await prisma.roleBinding.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
        .catch(() => {});
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => {});
      await prisma.team
        .deleteMany({ where: { id: { in: [teamId, otherTeamId] } } })
        .catch(() => {});
      await prisma.organization
        .deleteMany({ where: { id: { in: [orgId, otherOrgId] } } })
        .catch(() => {});
      await prisma.user
        .deleteMany({ where: { email: `del-org-admin-${ns}@example.com` } })
        .catch(() => {});
    });

    describe("given an ORGANIZATION-scoped provider viewed from a project in that org", () => {
      describe("when an org admin deletes it by id", () => {
        /** @scenario Delete an organization-scoped provider from a project settings view */
        it("removes the row and its scope grants instead of 404ing", async () => {
          const created = await repo().create({
            projectId: projectAId,
            name: `OpenAI Org ${ns}`,
            provider: "openai",
            enabled: true,
            customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          });

          await service().deleteModelProvider(
            { id: created.id, projectId: projectAId, provider: "openai" },
            ctxFor(orgAdminUserId),
          );

          const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
          expect(row).toBeNull();
          const scopes = await prisma.modelProviderScope.findMany({
            where: { modelProviderId: created.id },
          });
          expect(scopes).toHaveLength(0);
        });
      });
    });

    describe("given a provider scoped only to a sibling project in the same org", () => {
      describe("when an org admin deletes it from a different project's view", () => {
        /** @scenario Delete a provider scoped only to a sibling project in the same org */
        it("removes the row", async () => {
          const created = await repo().create({
            projectId: siblingProjectId,
            name: `OpenAI Sibling ${ns}`,
            provider: "anthropic",
            enabled: true,
            customKeys: { ANTHROPIC_API_KEY: `sk-sib-${ns}` },
            scopes: [{ scopeType: "PROJECT", scopeId: siblingProjectId }],
          });

          await service().deleteModelProvider(
            { id: created.id, projectId: projectAId, provider: "anthropic" },
            ctxFor(orgAdminUserId),
          );

          const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
          expect(row).toBeNull();
        });
      });
    });

    describe("given a provider that belongs to a different organization", () => {
      describe("when deleting it by id from my project", () => {
        /** @scenario Deleting a provider from a different organization is not found */
        it("rejects as NOT_FOUND and leaves the row intact", async () => {
          const created = await repo().create({
            projectId: otherProjectId,
            name: `OpenAI Other ${ns}`,
            provider: "openai",
            enabled: true,
            customKeys: { OPENAI_API_KEY: `sk-other-${ns}` },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: otherOrgId }],
          });

          await expect(
            service().deleteModelProvider(
              { id: created.id, projectId: projectAId, provider: "openai" },
              ctxFor(orgAdminUserId),
            ),
          ).rejects.toMatchObject({ code: "NOT_FOUND" });

          const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
          expect(row).not.toBeNull();
        });
      });
    });

    describe("given a provider with stored API keys", () => {
      describe("when it is deleted", () => {
        /** @scenario Deleting a provider removes its stored credentials */
        it("leaves no row with that provider id", async () => {
          const created = await repo().create({
            projectId: projectAId,
            name: `OpenAI Keyed ${ns}`,
            provider: "groq",
            enabled: true,
            customKeys: { GROQ_API_KEY: `sk-groq-${ns}` },
            scopes: [{ scopeType: "PROJECT", scopeId: projectAId }],
          });

          await service().deleteModelProvider(
            { id: created.id, projectId: projectAId, provider: "groq" },
            ctxFor(orgAdminUserId),
          );

          const row = await prisma.modelProvider.findUnique({ where: { id: created.id } });
          expect(row).toBeNull();
        });
      });
    });
  },
);
