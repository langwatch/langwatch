/**
 * @vitest-environment node
 *
 * Integration coverage for UserIngestionBindingService.install — pins
 * the cross-bind structural-impossibility shape end-to-end against a
 * real Postgres + locks the regression for bug #75 (Team-keyed lookup
 * tripping the dbOrganizationIdProtection guard). Caught by Ariana's
 * real-user dogfood when the EXEMPT_MODELS regression test (which only
 * exercises the projectId middleware) didn't catch it.
 *
 * Spec:
 *   specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
 *   specs/ai-gateway/governance/template-cross-bind-guard.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import { UserIngestionBindingService } from "../userIngestionBinding.service";

const suffix = nanoid(8);
const ORG_ID = `org-uib-${suffix}`;
const ALICE_ID = `usr-alice-${suffix}`;
const BOB_ID = `usr-bob-${suffix}`;
const ALICE_TEAM_ID = `team-alice-${suffix}`;
const BOB_TEAM_ID = `team-bob-${suffix}`;
const ALICE_PROJECT_ID = `proj-alice-${suffix}`;
const BOB_PROJECT_ID = `proj-bob-${suffix}`;
const TEMPLATE_ID = `tmpl-uib-${suffix}`;

describe("UserIngestionBindingService.install", () => {
  const service = UserIngestionBindingService.create(prisma);

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `UIB ${suffix}`, slug: `uib-${suffix}` },
    });
    await prisma.user.createMany({
      data: [
        { id: ALICE_ID, email: `alice-${suffix}@example.com`, name: "Alice" },
        { id: BOB_ID, email: `bob-${suffix}@example.com`, name: "Bob" },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: ALICE_ID, role: "MEMBER" },
        { organizationId: ORG_ID, userId: BOB_ID, role: "MEMBER" },
      ],
    });
    await prisma.team.createMany({
      data: [
        {
          id: ALICE_TEAM_ID,
          name: "Alice Personal",
          slug: `alice-personal-${suffix}`,
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: ALICE_ID,
        },
        {
          id: BOB_TEAM_ID,
          name: "Bob Personal",
          slug: `bob-personal-${suffix}`,
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: BOB_ID,
        },
      ],
    });
    await prisma.project.createMany({
      data: [
        {
          id: ALICE_PROJECT_ID,
          name: "Alice Project",
          slug: `alice-${suffix}`,
          apiKey: `alice-${suffix}`,
          teamId: ALICE_TEAM_ID,
          language: "typescript",
          framework: "other",
          isPersonal: true,
          ownerUserId: ALICE_ID,
        },
        {
          id: BOB_PROJECT_ID,
          name: "Bob Project",
          slug: `bob-${suffix}`,
          apiKey: `bob-${suffix}`,
          teamId: BOB_TEAM_ID,
          language: "typescript",
          framework: "other",
          isPersonal: true,
          ownerUserId: BOB_ID,
        },
      ],
    });
    await prisma.ingestionTemplate.create({
      data: {
        id: TEMPLATE_ID,
        organizationId: null,
        slug: `claude_code_uib_${suffix}`,
        sourceType: "claude_code",
        displayName: "Claude Code (test)",
        description: null,
        iconAsset: "preset:claude_code",
        credentialSchema: null,
        ottlRules: "",
        platformPublished: true,
        enabled: true,
      },
    });
  });

  describe("when Alice installs a platform template in her active org", () => {
    it("regression for bug #75 — completes without dbOrganizationIdProtection throwing on Team", async () => {
      // Pre-fix shape did `prisma.team.findFirst({ where: { ownerUserId,
      // isPersonal } })` which the orgId guard rejects. The fix queries
      // Project (exempt from both middlewares). This test fails on the
      // pre-fix code path with the orgId middleware error.
      const result = await service.install({
        callerUserId: ALICE_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID,
      });
      expect(result.token).toMatch(/^ik-lw-/);
      expect(result.binding.userId).toBe(ALICE_ID);
      expect(result.binding.templateId).toBe(TEMPLATE_ID);
      expect(result.binding.organizationId).toBe(ORG_ID);
      expect(result.binding.personalProjectId).toBe(ALICE_PROJECT_ID);
      expect(result.binding.bindingAccessTokenPrefix).toBe(
        result.token.slice(0, 9),
      );
    });

    it("emits a single gateway.user_ingestion_binding.installed AuditLog row", async () => {
      const audit = await prisma.auditLog.findFirst({
        where: {
          userId: ALICE_ID,
          action: "gateway.user_ingestion_binding.installed",
          targetKind: "user_ingestion_binding",
        },
        select: { id: true, projectId: true, organizationId: true, metadata: true },
      });
      expect(audit).not.toBeNull();
      expect(audit?.projectId).toBe(ALICE_PROJECT_ID);
      expect(audit?.organizationId).toBe(ORG_ID);
    });
  });

  describe("when Bob installs the SAME template in the SAME org", () => {
    it("lands the binding in Bob's personal project — cross-bind structural-impossibility holds", async () => {
      // Even though Alice already has a binding for templateId in this
      // org, Bob's call lands in HIS project, not Alice's. The
      // (userId, templateId) UNIQUE means Bob can have his own binding
      // for the same template; the personalProjectId is server-resolved
      // from Bob's userId, not from any input.
      const result = await service.install({
        callerUserId: BOB_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID,
      });
      expect(result.binding.userId).toBe(BOB_ID);
      expect(result.binding.personalProjectId).toBe(BOB_PROJECT_ID);
      // Critically: NOT alice's project.
      expect(result.binding.personalProjectId).not.toBe(ALICE_PROJECT_ID);
    });
  });

  describe("when Alice tries to install the same template twice", () => {
    it("rotates the token in place on the second call (no duplicate binding)", async () => {
      // The install is idempotent per (personalProjectId, sourceType): a
      // repeat install rotates Alice's existing binding token in place
      // instead of raising binding-already-exists.
      const first = await service.install({
        callerUserId: ALICE_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID,
      });
      const second = await service.install({
        callerUserId: ALICE_ID,
        organizationId: ORG_ID,
        templateId: TEMPLATE_ID,
      });

      expect(second.binding.id).toBe(first.binding.id);
      expect(second.token).not.toBe(first.token);

      const bindings = await prisma.userIngestionBinding.findMany({
        where: {
          userId: ALICE_ID,
          organizationId: ORG_ID,
          archivedAt: null,
        },
      });
      expect(bindings).toHaveLength(1);
    });
  });
});
