/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for the multi-instance create flow.
 * Adding a new ModelProvider must never silently overwrite an existing row
 * of the same provider type at a different scope. The bug it fixes:
 * `findExistingProvider` used to fall through to `findByProvider`, so
 * creating a second "OpenAI" at project scope clobbered the org-level row.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getApp } from "~/server/app-layer";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";

wireDefaultTestApp();

const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(!hasCredentialsSecret)(
  "ModelProviderService multi-instance create (real DB)",
  () => {
    const ns = `mp-multi-${nanoid(8)}`;

    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let orgAdminUserId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Multi Org ${ns}`, slug: `--test-${ns}` },
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
      await cleanupTestRows(prisma, [
        [
          "modelProvider",
          { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
        ],
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["user", { id: orgAdminUserId }],
        ["project", { id: projectId }],
        ["team", { id: teamId }],
        ["organization", { id: organizationId }],
      ]);
    });

    function service() {
      return getApp().modelProviders;
    }

    /** @scenario Create a second OpenAI row under a different scope */
    it("creates a second OpenAI row at a different scope instead of overwriting", async () => {
      const first = await service().upsert({
        projectId,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-project-${ns}` },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });

      const second = await service().upsert({
        projectId,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-org-${ns}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      expect(second.id).not.toBe(first.id);

      const rows = await prisma.modelProvider.findMany({
        where: { organizationId, provider: "openai" },
        include: { scopes: true },
      });

      expect(rows).toHaveLength(2);

      const scopesById = Object.fromEntries(
        rows.map((r) => [r.id, r.scopes.map((s) => `${s.scopeType}:${s.scopeId}`)]),
      );
      expect(scopesById[first.id]).toEqual([`PROJECT:${projectId}`]);
      expect(scopesById[second.id]).toEqual([`ORGANIZATION:${organizationId}`]);
    });

    /** @scenario Save a provider with multiple scopes */
    it("saves a single row with multiple ModelProviderScope entries", async () => {
      const result = await service().upsert({
        projectId,
        provider: "anthropic",
        name: "Anthropic Production",
        enabled: true,
        customKeys: { ANTHROPIC_API_KEY: `sk-ant-${ns}` },
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "TEAM", scopeId: teamId },
        ],
      });

      const stored = await prisma.modelProvider.findFirst({
        where: { id: result.id },
        include: { scopes: true },
      });

      expect(stored?.name).toBe("Anthropic Production");
      const scopes = (stored?.scopes ?? [])
        .map((s) => `${s.scopeType}:${s.scopeId}`)
        .sort();
      expect(scopes).toEqual([`ORGANIZATION:${organizationId}`, `TEAM:${teamId}`].sort());
    });

    it("updates an org-scoped provider by id from a project context without 404ing", async () => {
      const created = await service().upsert({
        projectId,
        provider: "openai",
        name: `OpenAI Org Edit ${ns}`,
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-org-edit-${ns}` },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });
      const createdRow = await prisma.modelProvider.findFirst({
        where: { id: created.id },
      });

      // The drawer's masked-only save: id + scopes, no customKeys. The row is
      // ORG-scoped, so a PROJECT-only lookup would 404. The org-anchored lookup
      // must find it and update it in place, preserving the stored key.
      const updated = await service().upsert({
        id: created.id,
        projectId,
        provider: "openai",
        name: `OpenAI Org Edit ${ns}`,
        enabled: true,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      expect(updated.id).toBe(created.id);
      const rows = await prisma.modelProvider.findMany({
        where: { name: `OpenAI Org Edit ${ns}`, organizationId },
        include: { scopes: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.scopes.map((s) => s.scopeType)).toEqual(["ORGANIZATION"]);
      // The stored credential is preserved (the masked-only save sends no key).
      expect(rows[0]!.customKeys).toEqual(createdRow!.customKeys);
    });
  },
);
