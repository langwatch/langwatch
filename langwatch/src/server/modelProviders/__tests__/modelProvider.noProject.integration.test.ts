/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for the provider write path on an
 * organization that has no project at all.
 *
 * A provider belongs to an organization and reaches the scopes attached to
 * it, so nothing on the write path needs a project. The write path used to
 * take `projectId` as required and resolve the organization back out of it,
 * which made an organization with no project unable to configure a
 * provider, and therefore unable to make the gateway route.
 *
 * These tests build an organization with a team and deliberately NO
 * project, then drive create / read / update / delete through the service
 * with only an organization anchor.
 *
 * Spec: specs/model-providers/providers-without-a-project.feature
 *
 * Requires PostgreSQL (Prisma) and a CREDENTIALS_SECRET, since the rows
 * store encrypted keys. The integration config supplies both: globalSetup
 * migrates the dedicated test database, and setupEnv pins a deterministic
 * CREDENTIALS_SECRET.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { appRouter } from "../../api/root";
import { createInnerTRPCContext } from "../../api/trpc";
import { prisma } from "../../db";
import { ModelProviderService } from "../modelProvider.service";

describe("ModelProviderService on an organization with no project (real DB)", () => {
  const ns = `mp-noproj-${nanoid(8)}`;

  let orgId: string;
  let teamId: string;
  let outsiderOrgId: string;
  let adminUserId: string;
  let outsiderUserId: string;
  let viewOnlyMemberUserId: string;
  let externalMemberUserId: string;

  const service = () => ModelProviderService.create(prisma);

  function ctxFor(userId: string) {
    return {
      prisma,
      session: { user: { id: userId }, expires: "1" } as any,
    };
  }

  // The tRPC layer is where the project requirement actually lived: the
  // `update` input took `projectId` as required and the permission
  // middleware resolved it to a real project, so the settings page could
  // not even reach the service without one.
  function callerFor(userId: string) {
    return appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: userId }, expires: "1" },
      }),
    );
  }

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `NoProj Org ${ns}`, slug: `--noproj-${ns}` },
    });
    orgId = org.id;

    // The governance signup shape: an organization and a team, and no
    // project anywhere in it.
    const team = await prisma.team.create({
      data: {
        name: `NoProj Team ${ns}`,
        slug: `--noproj-team-${ns}`,
        organizationId: orgId,
      },
    });
    teamId = team.id;

    const outsiderOrg = await prisma.organization.create({
      data: {
        name: `NoProj Outsider Org ${ns}`,
        slug: `--noproj-outsider-${ns}`,
      },
    });
    outsiderOrgId = outsiderOrg.id;

    const admin = await prisma.user.create({
      data: {
        name: "NoProj Org Admin",
        email: `noproj-admin-${ns}@example.com`,
      },
    });
    adminUserId = admin.id;
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

    // A plain MEMBER of this organization. Holds `organization:view` and
    // no manage permission anywhere.
    const viewOnly = await prisma.user.create({
      data: {
        name: "NoProj Read Only",
        email: `noproj-readonly-${ns}@example.com`,
      },
    });
    viewOnlyMemberUserId = viewOnly.id;
    await prisma.organizationUser.create({
      data: {
        userId: viewOnly.id,
        organizationId: orgId,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // An EXTERNAL (lite) member, the weakest seat that is still inside
    // the organization.
    const external = await prisma.user.create({
      data: {
        name: "NoProj External",
        email: `noproj-external-${ns}@example.com`,
      },
    });
    externalMemberUserId = external.id;
    await prisma.organizationUser.create({
      data: {
        userId: external.id,
        organizationId: orgId,
        role: OrganizationUserRole.EXTERNAL,
      },
    });

    const outsider = await prisma.user.create({
      data: {
        name: "NoProj Outsider",
        email: `noproj-outsider-${ns}@example.com`,
      },
    });
    outsiderUserId = outsider.id;
    await prisma.organizationUser.create({
      data: {
        userId: outsider.id,
        organizationId: outsiderOrgId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: outsiderOrgId,
        userId: outsider.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: outsiderOrgId,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      // ModelProvider's tenancy guard takes a literal organizationId,
      // not an in-list, so one entry per organization.
      ["modelProvider", { organizationId: orgId }],
      ["modelProvider", { organizationId: outsiderOrgId }],
      ["roleBinding", { organizationId: { in: [orgId, outsiderOrgId] } }],
      ["organizationUser", { organizationId: { in: [orgId, outsiderOrgId] } }],
      ["team", { id: teamId }],
      ["organization", { id: { in: [orgId, outsiderOrgId] } }],
      [
        "user",
        {
          email: {
            in: [
              `noproj-admin-${ns}@example.com`,
              `noproj-outsider-${ns}@example.com`,
              `noproj-readonly-${ns}@example.com`,
              `noproj-external-${ns}@example.com`,
            ],
          },
        },
      ],
    ]);
  });

  it("has no project, which is the state under test", async () => {
    const projectCount = await prisma.project.count({
      where: { team: { organizationId: orgId } },
    });

    expect(projectCount).toBe(0);
  });

  describe("given an org admin whose organization has no project", () => {
    describe("when they add a provider at organization scope", () => {
      /** @scenario "Saving the credential stores it against the organization" */
      it("stores it against the organization", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            name: `Create OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-noproject-create" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
          include: { scopes: true },
        });

        expect(stored?.organizationId).toBe(orgId);
        expect(stored?.enabled).toBe(true);
      });

      /** @scenario "Saving the credential stores it against the organization" */
      it("reaches organization scope", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "anthropic",
            name: `Scope Anthropic ${ns}`,
            enabled: true,
            customKeys: { ANTHROPIC_API_KEY: "sk-noproject-scope" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
          include: { scopes: true },
        });

        expect(stored?.scopes).toEqual([
          expect.objectContaining({
            scopeType: "ORGANIZATION",
            scopeId: orgId,
          }),
        ]);
      });

      /** @scenario "Saving the credential stores it against the organization" */
      it("creates no project along the way", async () => {
        await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            name: `NoProject Sentinel ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-noproject-sentinel" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        const projectCount = await prisma.project.count({
          where: { team: { organizationId: orgId } },
        });

        expect(projectCount).toBe(0);
      });

      /** @scenario "The saved provider shows the organization it belongs to" */
      it("shows up in the organization's provider list", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "deepseek",
            name: `Listed DeepSeek ${ns}`,
            enabled: true,
            customKeys: { DEEPSEEK_API_KEY: "sk-noproject-list" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        const listed = await service().listOrgModelProvidersForFrontend(orgId);

        expect(listed.map((p) => p.id)).toContain(created.id);
      });
    });

    describe("when they add a provider at team scope", () => {
      it("stores it against the team's organization", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            name: `Team OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-noproject-team" },
            scopes: [{ scopeType: "TEAM", scopeId: teamId }],
          },
          ctxFor(adminUserId),
        );

        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
          include: { scopes: true },
        });

        expect(stored?.organizationId).toBe(orgId);
        expect(stored?.scopes).toEqual([
          expect.objectContaining({ scopeType: "TEAM", scopeId: teamId }),
        ]);
      });
    });

    describe("when they edit a provider they already added", () => {
      /** @scenario "Changing the credential on it" */
      it("updates the same row instead of creating a second one", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            name: `Editable OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-noproject-edit" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        const updated = await service().updateModelProvider(
          {
            id: created.id,
            organizationId: orgId,
            provider: "openai",
            name: `Renamed OpenAI ${ns}`,
            enabled: true,
          },
          ctxFor(adminUserId),
        );

        const rows = await prisma.modelProvider.findMany({
          where: { organizationId: orgId, name: { contains: `OpenAI ${ns}` } },
        });

        expect(updated.id).toBe(created.id);
        expect(updated.name).toBe(`Renamed OpenAI ${ns}`);
        expect(rows.filter((r) => r.id === created.id)).toHaveLength(1);
      });

      it("preserves the stored credential when no new key is sent", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            name: `Keyed OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-noproject-preserved" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        await service().updateModelProvider(
          {
            id: created.id,
            organizationId: orgId,
            provider: "openai",
            name: `Keyed OpenAI Renamed ${ns}`,
            enabled: true,
          },
          ctxFor(adminUserId),
        );

        const listed = await service().listOrgModelProvidersForFrontend(orgId);
        const row = listed.find((p) => p.id === created.id);

        // The list masks keys, so "still credentialed" is what it can
        // report; the point is the rename did not blank the key.
        expect(row?.customKeys).toBeTruthy();
      });
    });

    describe("when they delete a provider they already added", () => {
      /** @scenario "Deleting it" */
      it("removes the row", async () => {
        const created = await service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "xai",
            name: `Doomed xAI ${ns}`,
            enabled: true,
            customKeys: { XAI_API_KEY: "sk-noproject-delete" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        );

        await service().deleteModelProvider(
          {
            id: created.id,
            organizationId: orgId,
            provider: "xai",
          },
          ctxFor(adminUserId),
        );

        const stored = await prisma.modelProvider.findUnique({
          where: { id: created.id },
        });

        expect(stored).toBeNull();
      });
    });
  });

  describe("given the settings page calls through tRPC with no project", () => {
    /** @scenario "Saving the credential stores it against the organization" */
    it("adds an organization-scoped provider", async () => {
      const created = await callerFor(adminUserId).modelProvider.update({
        organizationId: orgId,
        provider: "openai",
        name: `tRPC OpenAI ${ns}`,
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-noproject-trpc" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
      });

      const stored = await prisma.modelProvider.findUnique({
        where: { id: created.id },
        include: { scopes: true },
      });

      expect(stored?.organizationId).toBe(orgId);
      expect(stored?.scopes).toEqual([
        expect.objectContaining({
          scopeType: "ORGANIZATION",
          scopeId: orgId,
        }),
      ]);
    });

    /** @scenario "Changing the credential on it" */
    it("edits it afterwards", async () => {
      const caller = callerFor(adminUserId);
      const created = await caller.modelProvider.update({
        organizationId: orgId,
        provider: "openai",
        name: `tRPC Editable ${ns}`,
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-noproject-trpc-edit" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
      });

      const updated = await caller.modelProvider.update({
        id: created.id,
        organizationId: orgId,
        provider: "openai",
        name: `tRPC Edited ${ns}`,
        enabled: true,
      });

      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe(`tRPC Edited ${ns}`);
    });

    /** @scenario "Deleting it" */
    it("deletes it afterwards", async () => {
      const caller = callerFor(adminUserId);
      const created = await caller.modelProvider.update({
        organizationId: orgId,
        provider: "openai",
        name: `tRPC Doomed ${ns}`,
        enabled: true,
        customKeys: { OPENAI_API_KEY: "sk-noproject-trpc-delete" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
      });

      await caller.modelProvider.delete({
        id: created.id,
        organizationId: orgId,
        provider: "openai",
      });

      expect(
        await prisma.modelProvider.findUnique({ where: { id: created.id } }),
      ).toBeNull();
    });

    /** @scenario "Adding a provider for an organization I do not manage" */
    it("refuses someone who is not in the organization at all", async () => {
      await expect(
        callerFor(outsiderUserId).modelProvider.update({
          organizationId: orgId,
          provider: "openai",
          name: `tRPC Intruder ${ns}`,
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-trpc-intruder" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
        }),
      ).rejects.toThrow(/permission/i);
    });

    it("refuses a request that names no tenant", async () => {
      await expect(
        callerFor(adminUserId).modelProvider.update({
          provider: "openai",
          enabled: true,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
        } as any),
      ).rejects.toThrow(/projectId or organizationId/);
    });
  });

  // The credential probe sends caller-supplied keys, and for the `custom`
  // provider a caller-supplied base URL, straight out over the network.
  // Nothing downstream re-authorizes it, so the gate on the way in is the
  // whole of the authorization. `organization:view` is held by MEMBER and
  // EXTERNAL, which would have made this an arbitrary outbound request
  // from a read-only seat.
  describe("given a read-only member of a projectless organization", () => {
    let fetchCalls: string[];
    let realFetch: typeof globalThis.fetch;

    beforeEach(() => {
      fetchCalls = [];
      realFetch = globalThis.fetch;
      // Records rather than stubs the outcome: the assertion is that the
      // request never leaves, so a test that passed because the fetch
      // merely failed would be worthless.
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        fetchCalls.push(String(args[0]));
        throw new Error("network disabled in test");
      }) as typeof globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    /** @scenario "A read-only member cannot probe an arbitrary URL" */
    it("refuses a MEMBER before any URL is fetched", async () => {
      await expect(
        callerFor(viewOnlyMemberUserId).modelProvider.validateApiKey({
          organizationId: orgId,
          provider: "custom",
          customKeys: {
            CUSTOM_API_KEY: "x",
            CUSTOM_BASE_URL: "http://169.254.169.254/latest/meta-data",
          },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
        }),
        // The permission slug is asserted on `meta`, not on the message. It
        // used to be readable in the prose only because the prose recited an
        // internal RBAC identifier at the customer; the sentence is now copy,
        // and `meta.requiredPermission` is the machine-readable fact. Which
        // permission was demanded is still the claim under test — it is what
        // separates this case from the TEAM-scope one below.
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: {
          code: "model_provider_scope_forbidden",
          meta: {
            scopeType: "ORGANIZATION",
            requiredPermission: "organization:manage",
          },
        },
      });

      expect(fetchCalls).toEqual([]);
    });

    /** @scenario "A read-only member cannot probe an arbitrary URL" */
    it("refuses an EXTERNAL member before any URL is fetched", async () => {
      await expect(
        callerFor(externalMemberUserId).modelProvider.validateApiKey({
          organizationId: orgId,
          provider: "custom",
          customKeys: {
            CUSTOM_API_KEY: "x",
            CUSTOM_BASE_URL: "http://169.254.169.254/latest/meta-data",
          },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: {
          code: "model_provider_scope_forbidden",
          meta: {
            scopeType: "ORGANIZATION",
            requiredPermission: "organization:manage",
          },
        },
      });

      expect(fetchCalls).toEqual([]);
    });

    /** @scenario "A read-only member cannot probe an arbitrary URL" */
    it("refuses a member who names a team they cannot manage", async () => {
      await expect(
        callerFor(viewOnlyMemberUserId).modelProvider.validateApiKey({
          organizationId: orgId,
          provider: "custom",
          customKeys: {
            CUSTOM_API_KEY: "x",
            CUSTOM_BASE_URL: "http://169.254.169.254/latest/meta-data",
          },
          scopes: [{ scopeType: "TEAM", scopeId: teamId }],
        }),
        // TEAM scope, so `team:manage` — the distinction this test exists for.
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: {
          code: "model_provider_scope_forbidden",
          meta: { scopeType: "TEAM", requiredPermission: "team:manage" },
        },
      });

      expect(fetchCalls).toEqual([]);
    });

    /** @scenario "A read-only member cannot probe an arbitrary URL" */
    it("refuses a probe that names no scopes to be authorized against", async () => {
      await expect(
        callerFor(viewOnlyMemberUserId).modelProvider.validateApiKey({
          organizationId: orgId,
          provider: "custom",
          customKeys: {
            CUSTOM_API_KEY: "x",
            CUSTOM_BASE_URL: "http://169.254.169.254/latest/meta-data",
          },
        }),
      ).rejects.toThrow(/scopes/);

      expect(fetchCalls).toEqual([]);
    });

    // The gate has to let the legitimate case through, or the fix is just
    // a broken feature. An org admin reaches the probe, and the recorded
    // call proves it got as far as the network.
    /** @scenario "Checking a credential for a scope I can manage" */
    it("lets an org admin through to the request", async () => {
      await expect(
        callerFor(adminUserId).modelProvider.validateApiKey({
          organizationId: orgId,
          provider: "custom",
          customKeys: {
            CUSTOM_API_KEY: "x",
            CUSTOM_BASE_URL: "https://example.invalid/v1",
          },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
        }),
      ).resolves.toEqual(expect.objectContaining({ valid: false }));

      expect(fetchCalls.length).toBeGreaterThan(0);
    });
  });

  describe("given someone who does not manage the organization", () => {
    /** @scenario "Adding a provider for an organization I do not manage" */
    it("refuses the create and stores nothing", async () => {
      const before = await prisma.modelProvider.count({
        where: { organizationId: orgId },
      });

      await expect(
        service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            name: `Intruder OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-intruder" },
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(outsiderUserId),
        ),
        // Straight at the service, so no tRPC wrapper: the handled error
        // itself is what arrives, and its `code` is the assertion.
      ).rejects.toMatchObject({
        code: "model_provider_scope_forbidden",
        meta: {
          scopeType: "ORGANIZATION",
          requiredPermission: "organization:manage",
        },
      });

      const after = await prisma.modelProvider.count({
        where: { organizationId: orgId },
      });
      expect(after).toBe(before);
    });

    /** @scenario "Assigning a provider to a scope I do not control" */
    it("refuses the whole write when one scope is unmanageable", async () => {
      const before = await prisma.modelProvider.count({
        where: { organizationId: outsiderOrgId },
      });

      await expect(
        service().updateModelProvider(
          {
            organizationId: outsiderOrgId,
            provider: "openai",
            name: `Reaching OpenAI ${ns}`,
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-reaching" },
            scopes: [
              { scopeType: "ORGANIZATION", scopeId: outsiderOrgId },
              { scopeType: "TEAM", scopeId: teamId },
            ],
          },
          ctxFor(outsiderUserId),
        ),
        // The TEAM entry is the one that fails, and it fails the whole write:
        // asserting `team:manage` is what proves the refusal came from that
        // second scope rather than from the org the caller does own.
      ).rejects.toMatchObject({
        code: "model_provider_scope_forbidden",
        meta: { scopeType: "TEAM", requiredPermission: "team:manage" },
      });

      const after = await prisma.modelProvider.count({
        where: { organizationId: outsiderOrgId },
      });
      expect(after).toBe(before);
    });
  });

  describe("given a write that names no tenant at all", () => {
    it("is refused rather than guessing one", async () => {
      await expect(
        service().updateModelProvider(
          {
            provider: "openai",
            enabled: true,
            scopes: [{ scopeType: "ORGANIZATION", scopeId: orgId }],
          },
          ctxFor(adminUserId),
        ),
        // The code, not the prose: the message is copy and free to change,
        // while the code is the part a caller branches on.
      ).rejects.toMatchObject({ code: "model_provider_anchor_required" });
    });
  });

  describe("given a create with an organization but no scopes", () => {
    it("is refused rather than defaulting to a project that does not exist", async () => {
      await expect(
        service().updateModelProvider(
          {
            organizationId: orgId,
            provider: "openai",
            enabled: true,
          },
          ctxFor(adminUserId),
        ),
      ).rejects.toMatchObject({ code: "model_provider_scopes_required" });
    });
  });
});
