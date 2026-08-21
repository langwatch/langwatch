/**
 * @vitest-environment node
 *
 * Real-Postgres coverage for the routing handle: the name that addresses ONE
 * model provider instance in a gateway model string. The partial unique index
 * is what actually makes the name unique inside an organization, so it has to
 * be exercised against a real database rather than a mock that would agree
 * with whatever the service believes.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";

import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";
import { ModelProviderService } from "../modelProvider.service";

const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(!hasCredentialsSecret)(
  "ModelProviderService routing handle (real DB)",
  () => {
    const ns = `mp-handle-${nanoid(8)}`;

    let organizationId: string;
    let otherOrganizationId: string;
    let teamId: string;
    let otherTeamId: string;
    let projectId: string;
    let otherProjectId: string;
    let adminUserId: string;

    async function seedTenant(label: string) {
      const organization = await prisma.organization.create({
        data: { name: `Handle Org ${label}`, slug: `--test-${label}` },
      });
      const team = await prisma.team.create({
        data: {
          name: `Team ${label}`,
          slug: `--team-${label}`,
          organizationId: organization.id,
        },
      });
      const project = await prisma.project.create({
        data: {
          name: `Project ${label}`,
          slug: `--proj-${label}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${label}`,
        },
      });
      return { organization, team, project };
    }

    beforeAll(async () => {
      const main = await seedTenant(ns);
      organizationId = main.organization.id;
      teamId = main.team.id;
      projectId = main.project.id;

      const other = await seedTenant(`${ns}-b`);
      otherOrganizationId = other.organization.id;
      otherTeamId = other.team.id;
      otherProjectId = other.project.id;

      const admin = await prisma.user.create({
        data: { name: "Admin", email: `admin-${ns}@example.com` },
      });
      adminUserId = admin.id;
      for (const orgId of [organizationId, otherOrganizationId]) {
        await prisma.organizationUser.create({
          data: {
            userId: admin.id,
            organizationId: orgId,
            role: OrganizationUserRole.ADMIN,
          },
        });
        await prisma.roleBinding.create({
          data: {
            organizationId: orgId,
            userId: admin.id,
            role: TeamUserRole.ADMIN,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: orgId,
          },
        });
      }
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["modelProvider", { organizationId }],
        ["modelProvider", { organizationId: otherOrganizationId }],
        ["roleBinding", { organizationId }],
        ["roleBinding", { organizationId: otherOrganizationId }],
        ["organizationUser", { organizationId }],
        ["organizationUser", { organizationId: otherOrganizationId }],
        ["user", { id: adminUserId }],
        ["project", { id: projectId }],
        ["project", { id: otherProjectId }],
        ["team", { id: teamId }],
        ["team", { id: otherTeamId }],
        ["organization", { id: organizationId }],
        ["organization", { id: otherOrganizationId }],
      ]);
    });

    function ctx() {
      return {
        prisma,
        session: {
          user: {
            id: adminUserId,
            email: `admin-${ns}@example.com`,
            name: "Admin",
          },
          expires: "2099-01-01T00:00:00.000Z",
        } as any,
      };
    }

    async function createProvider({
      project,
      handle,
      suffix,
    }: {
      project: string;
      handle?: string | null;
      suffix: string;
    }) {
      return await ModelProviderService.create(prisma).updateModelProvider(
        {
          projectId: project,
          provider: "anthropic",
          enabled: true,
          name: `Anthropic ${suffix}`,
          customKeys: { ANTHROPIC_API_KEY: `sk-${suffix}` },
          scopes: [{ scopeType: "PROJECT", scopeId: project }],
          ...(handle !== undefined && { routingHandle: handle }),
        },
        ctx(),
      );
    }

    async function setHandle(id: string, handle: string | null) {
      return await ModelProviderService.create(prisma).updateModelProvider(
        {
          id,
          projectId,
          provider: "anthropic",
          enabled: true,
          routingHandle: handle,
        },
        ctx(),
      );
    }

    describe("given an administrator sets a handle", () => {
      /** @scenario "A handle is stored lowercased" */
      it("stores it lowercased", async () => {
        const created = await createProvider({
          project: projectId,
          handle: "MixedCase",
          suffix: `${ns}-mixed`,
        });
        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
          select: { routingHandle: true },
        });
        expect(stored?.routingHandle).toBe("mixedcase");
      });
    });

    describe("when a second provider in the organization takes the name", () => {
      /** @scenario "Two providers in one organization cannot share a handle" */
      it("refuses the write and says the handle is in use", async () => {
        await createProvider({
          project: projectId,
          handle: "eu",
          suffix: `${ns}-eu`,
        });

        await expect(
          createProvider({
            project: projectId,
            handle: "eu",
            suffix: `${ns}-eu2`,
          }),
        ).rejects.toMatchObject({
          code: "model_provider_routing_handle_taken",
        });
      });

      /** @scenario "Two organizations can use the same handle" */
      it("lets another organization use the same name", async () => {
        const created = await createProvider({
          project: otherProjectId,
          handle: "eu",
          suffix: `${ns}-other-eu`,
        });
        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
          select: { routingHandle: true, organizationId: true },
        });
        expect(stored?.routingHandle).toBe("eu");
        expect(stored?.organizationId).toBe(otherOrganizationId);
      });
    });

    describe("when a handle is cleared", () => {
      /** @scenario "Clearing a handle releases the name" */
      it("empties the handle and frees the name for another provider", async () => {
        const holder = await createProvider({
          project: projectId,
          handle: "release-me",
          suffix: `${ns}-release`,
        });

        await setHandle(holder.id, "");

        const cleared = await prisma.modelProvider.findUnique({
          where: { id: holder.id },
          select: { routingHandle: true },
        });
        expect(cleared?.routingHandle).toBeNull();

        const taker = await createProvider({
          project: projectId,
          handle: "release-me",
          suffix: `${ns}-taker`,
        });
        const stored = await prisma.modelProvider.findUnique({
          where: { id: taker.id },
          select: { routingHandle: true },
        });
        expect(stored?.routingHandle).toBe("release-me");
      });
    });

    describe("when a handle is renamed", () => {
      /** @scenario "A renamed handle no longer resolves under its old name" */
      it("stops answering to the old name and evicts the gateway config", async () => {
        const provider = await createProvider({
          project: projectId,
          handle: "before",
          suffix: `${ns}-rename`,
        });

        const eventsBefore = await prisma.gatewayChangeEvent.count({
          where: { organizationId, kind: "MODEL_PROVIDER_UPDATED" },
        });

        await setHandle(provider.id, "after");

        const stored = await prisma.modelProvider.findUnique({
          where: { id: provider.id },
          select: { routingHandle: true },
        });
        expect(stored?.routingHandle).toBe("after");

        // The old name is free again, which is the same thing as saying it no
        // longer resolves to this provider.
        const reuser = await createProvider({
          project: projectId,
          handle: "before",
          suffix: `${ns}-rename-reuse`,
        });
        expect(reuser.id).not.toBe(provider.id);

        const eventsAfter = await prisma.gatewayChangeEvent.count({
          where: { organizationId, kind: "MODEL_PROVIDER_UPDATED" },
        });
        expect(eventsAfter).toBeGreaterThan(eventsBefore);
      });
    });

    describe("when a provider is created with a handle", () => {
      /** @scenario "Creating a provider evicts the gateway configuration" */
      it("evicts the gateway config so the handle resolves immediately", async () => {
        const eventsBefore = await prisma.gatewayChangeEvent.count({
          where: { organizationId, kind: "MODEL_PROVIDER_UPDATED" },
        });

        const created = await createProvider({
          project: projectId,
          handle: "created-evicts",
          suffix: `${ns}-create-evict`,
        });

        const eventsAfter = await prisma.gatewayChangeEvent.count({
          where: { organizationId, kind: "MODEL_PROVIDER_UPDATED" },
        });
        expect(eventsAfter).toBeGreaterThan(eventsBefore);

        const event = await prisma.gatewayChangeEvent.findFirst({
          where: {
            organizationId,
            kind: "MODEL_PROVIDER_UPDATED",
            modelProviderId: created.id,
          },
        });
        expect(event).not.toBeNull();
      });
    });

    describe("when the handle is not a name the gateway can read", () => {
      it("refuses a reserved provider family name", async () => {
        await expect(
          createProvider({
            project: projectId,
            handle: "anthropic",
            suffix: `${ns}-reserved`,
          }),
        ).rejects.toMatchObject({
          code: "model_provider_routing_handle_invalid",
        });
      });

      it("refuses characters a model string cannot carry", async () => {
        await expect(
          createProvider({
            project: projectId,
            handle: "not a handle",
            suffix: `${ns}-shape`,
          }),
        ).rejects.toMatchObject({
          code: "model_provider_routing_handle_invalid",
        });
      });
    });
  },
);
