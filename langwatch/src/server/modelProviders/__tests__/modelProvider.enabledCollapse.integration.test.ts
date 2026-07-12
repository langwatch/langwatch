/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for the multi-scope collapse's
 * `enabled` tie-break. The bug it fixes (#5575): `isNarrower` used to
 * collapse by scope narrowness only, so a disabled PROJECT-scoped row
 * masked an enabled ORGANIZATION-scoped row — gating off Ask AI via
 * `hasEnabledProviders` on the frontend even though an enabled row
 * existed at a wider scope.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../db";
import { ModelProviderService } from "../modelProvider.service";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(isTestcontainersOnly || !hasCredentialsSecret)(
  "ModelProviderService enabled-vs-scope collapse (real DB)",
  () => {
    const ns = `mp-enabled-${nanoid(8)}`;

    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let orgAdminUserId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Enabled Collapse Org ${ns}`, slug: `--test-${ns}` },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: {
          name: `Team ${ns}`,
          slug: `--team-${ns}`,
          organizationId,
        },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Project ${ns}`,
          slug: `--proj-${ns}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${ns}`,
        },
      });
      projectId = project.id;

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
    });

    afterAll(async () => {
      await prisma.modelProvider.deleteMany({
        where: {
          OR: [
            {
              scopes: {
                some: { scopeType: "PROJECT", scopeId: projectId },
              },
            },
            {
              scopes: {
                some: {
                  scopeType: "ORGANIZATION",
                  scopeId: organizationId,
                },
              },
            },
          ],
        },
      });
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { id: orgAdminUserId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    });

    function service() {
      return ModelProviderService.create(prisma);
    }

    function ctx() {
      return {
        prisma,
        session: {
          user: {
            id: orgAdminUserId,
            email: `org-admin-${ns}@example.com`,
            name: "Org Admin",
          },
          expires: "2099-01-01T00:00:00.000Z",
        } as any,
      };
    }

    /**
     * @scenario Disabled PROJECT row must not mask an enabled ORGANIZATION row.
     * Regression for #5575: the collapse used to pick the narrower
     * (PROJECT) row regardless of `enabled`, so the disabled project
     * override hid the enabled org-wide provider and gated off Ask AI.
     */
    it("prefers an enabled wider-scope row over a disabled narrower-scope row", async () => {
      // Enabled at ORGANIZATION scope — the real, working credential.
      await service().updateModelProvider(
        {
          projectId,
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        },
        ctx(),
      );

      // Disabled at PROJECT scope — a stale project-level override.
      await service().updateModelProvider(
        {
          projectId,
          provider: "openai",
          enabled: false,
          customKeys: { OPENAI_API_KEY: `sk-project-disabled-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        },
        ctx(),
      );

      const result = await service().getProjectModelProvidersForFrontend(
        projectId,
      );

      expect(result.openai).toBeDefined();
      // `noUncheckedIndexedAccess` makes `result.openai` possibly
      // undefined; vitest's toBeDefined() doesn't narrow the type, so
      // assert non-null on the property accesses below.
      expect(result.openai!.enabled).toBe(true);
      // The enabled ORGANIZATION row wins; the disabled PROJECT row
      // does not mask it.
      expect(result.openai!.scopeType).toBe("ORGANIZATION");
    });

    /**
     * @scenario When both rows are enabled, the narrower (PROJECT) scope
     * still wins — preserves the iter 107/108 semantics that the
     * scope-only collapse was originally introduced for.
     */
    it("still picks the narrower scope when both rows are enabled", async () => {
      // Distinct provider so the prior test's openai rows don't interfere.
      await service().updateModelProvider(
        {
          projectId,
          provider: "anthropic",
          enabled: true,
          customKeys: { ANTHROPIC_API_KEY: `sk-ant-org-${ns}` },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        },
        ctx(),
      );

      await service().updateModelProvider(
        {
          projectId,
          provider: "anthropic",
          enabled: true,
          customKeys: { ANTHROPIC_API_KEY: `sk-ant-project-${ns}` },
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        },
        ctx(),
      );

      const result = await service().getProjectModelProvidersForFrontend(
        projectId,
      );

      expect(result.anthropic).toBeDefined();
      expect(result.anthropic!.enabled).toBe(true);
      // Narrower (PROJECT) scope wins when enabled states are equal.
      expect(result.anthropic!.scopeType).toBe("PROJECT");
    });
  },
);
