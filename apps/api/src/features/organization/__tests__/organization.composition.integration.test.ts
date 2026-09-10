/**
 * @vitest-environment node
 *
 * The organization module, installed and booted the way the API process boots
 * it. The shell's very first call is `organization.getAll`, so what this
 * proves is that the install answers it: a namespace that mounts and refuses
 * looks identical to a healthy one until somebody signs in.
 */
import type { BrowserSessionApi } from "@langwatch/auth-contract";
import type { AuthzApi, AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { organizationRepositories } from "@langwatch/organization-server";
import { instantiateRepositories } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  installApiOrganization,
  refusingOrganizationFeature,
} from "../organization.composition.ts";
import { stubInfrastructureEntitlements } from "../../../app/__tests__/api-trpc-record.test-doubles.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const CALLER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test" };
const BASE_API_KEY = "test-base-key";

/**
 * The rows this install actually reads, held in memory as a Prisma double.
 * The organization, team and group repositories are selected through the
 * "postgres" backend here (this process's real shape), so this is still the
 * seam the boot proves the install reaches. The "given the memory-backed
 * repositories" block below proves the OTHER backend, `defineRepositories`
 * selects for tests and for a memory-only process, reads back its own writes.
 */
function memoryPrisma() {
  const organization = {
    id: ORGANIZATION_ID,
    name: "Acme",
    slug: "acme",
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Endpoint: null,
    members: [{ userId: CALLER.id, organizationId: ORGANIZATION_ID, role: "ADMIN" }],
    teams: [
      {
        id: "team-1",
        organizationId: ORGANIZATION_ID,
        members: [{ userId: CALLER.id, teamId: "team-1", role: "ADMIN" }],
        projects: [
          {
            id: PROJECT_ID,
            teamId: "team-1",
            apiKey: BASE_API_KEY,
            lwqlKey: "stored-lwql-key",
            s3AccessKeyId: null,
            s3SecretAccessKey: null,
            s3Endpoint: null,
          },
        ],
      },
    ],
  };

  return {
    organization: {
      findMany: vi.fn(async () => [organization]),
      findUnique: vi.fn(async () => organization),
      findFirst: vi.fn(async () => organization),
    },
    organizationUser: {
      findMany: vi.fn(async () => organization.members),
      findUnique: vi.fn(async () => organization.members[0]),
    },
    organizationInvite: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    team: { findUnique: vi.fn(async () => organization.teams[0]) },
    teamUser: { findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
}

/** Permits everything: a refusal path is the declared check's own suite. */
function testPermissions(): AuthzApi {
  return {
    hasPermission: vi.fn(async () => true),
    listBindingsForSynthesis: vi.fn(async () => []),
    attachBindings: vi.fn(async () => undefined),
    revokeBindingsWhere: vi.fn(async () => undefined),
    invalidateOrganization: vi.fn(async () => undefined),
  } as unknown as AuthzApi;
}

/**
 * The invitation service a deployment composes, as the install takes it. The
 * pending-invite read has to reach the rows: an empty list tells an
 * administrator nobody has been invited, which is the one answer they act on
 * by inviting the same person twice.
 */
function testInvitations() {
  const listInvites = vi.fn(async () => [
    {
      id: "invite-1",
      organizationId: ORGANIZATION_ID,
      email: "newcomer@acme.test",
      inviteCode: "code-1",
      role: "MEMBER",
      status: "PENDING",
      inviteUrl: "https://app.langwatch.test/invite/accept?inviteCode=code-1",
      displayStatus: "PENDING",
      requestedByUser: null,
    },
  ]);
  const refuse = () => {
    throw new Error("this scenario reaches only the pending-invite read");
  };

  return {
    listInvites,
    ports: {
      listInvites: (_context: never, input: { organizationId: string }) => listInvites(),
      createInvites: refuse,
      revokeInvite: refuse,
      assertInviteSendAllowed: refuse,
      resendInvite: refuse,
      matchInviteToAcceptor: refuse,
      maskInvitedAddress: refuse,
      applyInvite: refuse,
      tryFindLandingProjectSlug: refuse,
      resolveJoinRequestByInvitation: refuse,
      withdrawJoinRequestOnInvitationAccepted: refuse,
    } as never,
  };
}

async function install(options: { invitations?: { ports: never } } = {}) {
  const prisma = memoryPrisma();
  const permissions = testPermissions();

  return installApiOrganization({
    infrastructure: {
      ...stubInfrastructureEntitlements(),
      prisma,
      authz: permissions as unknown as AuthzService,
    },
    peers: {
      encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value },
      ...(options.invitations ? { invites: options.invitations } : {}),
      membership: {
        organizations: {} as never,
        projects: { create: vi.fn(), listByTeam: vi.fn(async () => []) } as unknown as ProjectApi,
        permissions,
        grants: permissions as unknown as AuthzGrantsService,
        auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) } as unknown as BrowserSessionApi,
        users: { ensurePersonalWorkspace: vi.fn(async () => ({})) } as unknown as Pick<
          UserApi,
          "ensurePersonalWorkspace"
        >,
        eventing: {} as never,
        processName: "langwatch-api-test",
      },
    },
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    baseHost: "https://app.langwatch.test",
    demoProject: { userId: "", projectId: "" },
    identity: createApiFixture<IdentityApi>(),
  });
}

describe("given the organization module installed on an API process", () => {
  describe("when the shell asks for the organizations it can reach", () => {
    /**
     * The read has to reach the rows, not merely stop refusing: an empty list
     * renders as a person with no organization, which is the one answer the
     * shell cannot tell apart from a broken install.
     */
    it("answers from the organization rows", async () => {
      const feature = await install();

      const organizations = await feature.app.listVisibleOrganizations({ isDemo: false }, CALLER);

      expect(organizations.map((organization) => organization.id)).toEqual([ORGANIZATION_ID]);
    });

    it("hands the project base key to a caller who can change the project", async () => {
      const feature = await install();

      const organizations = await feature.app.listVisibleOrganizations({ isDemo: false }, CALLER);

      expect(organizations[0]?.teams[0]?.projects[0]?.apiKey).toBe(BASE_API_KEY);
    });

    it("never hands anybody the LangWatchQL key", async () => {
      const feature = await install();

      const organizations = await feature.app.listVisibleOrganizations({ isDemo: false }, CALLER);

      expect(organizations[0]?.teams[0]?.projects[0]?.lwqlKey).toBe("");
    });
  });

  describe("when the deployment composed an invitation service", () => {
    /**
     * The read must reach the rows, not just stop refusing: a port answering
     * `[]` would pass a test checking only that, and an empty invitation list
     * is the one answer that leads an administrator to invite the same person
     * twice.
     */
    it("answers the pending-invite read from the invitation rows", async () => {
      const invitations = testInvitations();
      const feature = await install({ invitations });

      const pending = await feature.app.listPendingInvitations({
        organizationId: ORGANIZATION_ID,
      });

      expect(pending.map((invite) => invite.email)).toEqual(["newcomer@acme.test"]);
      expect(invitations.listInvites).toHaveBeenCalled();
    });
  });

  describe("when the deployment composed no invitation service", () => {
    it("refuses the pending-invite read by name rather than answering with none", async () => {
      const feature = await install();

      await expect(
        feature.app.listPendingInvitations({ organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
  });

  describe("when this process composed no membership graph", () => {
    it("refuses the read by name rather than answering with no organization", () => {
      const feature = refusingOrganizationFeature();

      expect(() => feature.app.listVisibleOrganizations({ isDemo: false }, CALLER)).toThrow(
        expect.objectContaining({ code: "service_unavailable" }),
      );
    });
  });
});

describe("given the memory-backed organization repositories", () => {
  /**
   * The organization module's own registry, over no database at all - the
   * same selection a memory-only test or process makes with
   * `.withPersistence("memory", {})`. A write followed by a read through the
   * SAME instances is what proves the memory backend is not a stub: `team`
   * and `group` share the repository's one in-memory database, the way
   * Postgres would share one connection.
   */
  it("reads back a team it just wrote", async () => {
    const repositories = instantiateRepositories(organizationRepositories, {
      backend: "memory",
      infrastructure: {},
    });

    const created = await repositories.team.create({
      teamId: "team-mem-1",
      name: "Memory Team",
      slug: "memory-team",
      organizationId: ORGANIZATION_ID,
    });

    await expect(
      repositories.team.get({ teamId: created.id, organizationId: ORGANIZATION_ID }),
    ).resolves.toMatchObject({ id: "team-mem-1", name: "Memory Team", slug: "memory-team" });
  });

  /**
   * `membership` shares the SAME in-memory database `organization` and `team`
   * do (`MemoryOrganizationDatabase`): a sign-up written through `membership`
   * is what the caller's own membership read answers back, the way a real
   * Postgres transaction and the next `SELECT` on the same connection would.
   */
  it("reads back the admin seat a sign-up just wrote", async () => {
    const repositories = instantiateRepositories(organizationRepositories, {
      backend: "memory",
      infrastructure: {},
    });

    const membership = repositories.membership(createApiFixture<AuthzGrantsService>());
    const created = await membership.createAndAssign({
      userId: "user-mem-1",
      orgId: "org-mem-1",
      orgName: "Memory Org",
      orgSlug: "memory-org",
      teamId: "team-mem-2",
      teamSlug: "memory-org-team",
      pricingModel: "SEAT_EVENT",
    });

    await expect(
      membership.tryGetUserOrgRole({
        userId: "user-mem-1",
        organizationId: created.organization.id,
      }),
    ).resolves.toBe("ADMIN");
  });
});
