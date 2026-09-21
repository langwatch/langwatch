import { generate } from "@langwatch/ksuid";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "~/generated/prisma/client";
import {
  identityCeremonies,
  identityService,
} from "~/server/app-layer/identity/runtime";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { PrismaSsoMigrationEvidenceRepository } from "../sso-migration-evidence.prisma.repository";
import { PrismaSsoLegacyIdentityRetirement } from "../sso-migration-legacy-retirement.prisma.repository";
import {
  MIGRATION_NOW,
  MIGRATION_STARTED_AT,
  migrationConnectionData,
} from "./sso-migration-evidence.fixture";

const namespace = generate("ssomig").toString();
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other`;
const organizationIds = [organizationId, otherOrganizationId];
const legacyId = `${namespace}-legacy`;
const directId = `${namespace}-direct`;
const foreignLegacyId = `${namespace}-foreign-legacy`;
const domain = `${namespace}.test`;
const userId = (name: string) => `${namespace}-${name}`;
const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const holdsPassword = vi.fn(async () => true);
const recovery = {
  hasLiveBinding: vi.fn(async () => true),
  reserveActivationRecovery: async () => true,
};
const repository = PrismaSsoMigrationEvidenceRepository.create({
  prisma,
  recovery,
  holdsPassword,
  now: () => MIGRATION_NOW.getTime(),
});

const progress = (cursor: string | null = null, limit = 25) =>
  repository.getProgress({
    organizationId,
    connectionId: directId,
    cursor,
    limit,
  });
const inspect = () =>
  repository.inspect({ organizationId, replacementConnectionId: directId });

async function member(
  name: string,
  options: { disabled?: boolean; organizationId?: string } = {},
) {
  const id = userId(name);
  await prisma.user.create({ data: { id, name, email: `${id}@example.test` } });
  await prisma.organizationUser.create({
    data: {
      userId: id,
      organizationId: options.organizationId ?? organizationId,
      role: "MEMBER",
      disabledAt: options.disabled ? MIGRATION_STARTED_AT : null,
    },
  });
  return id;
}

async function identifier({
  name,
  user,
  state = "VERIFIED",
  connectionId = directId,
  accountId = null,
}: {
  name: string;
  user: string;
  state?: string;
  connectionId?: string;
  accountId?: string | null;
}) {
  await prisma.identifier.create({
    data: {
      id: `${namespace}-identifier-${name}`,
      userId: user,
      provider: "oidc",
      state,
      connectionId,
      accountId,
      attachedAt: MIGRATION_STARTED_AT,
    },
  });
}

async function authentication(
  connectionId: string,
  user: string,
  authenticatedAt: Date,
) {
  await prisma.ssoAuthenticationActivity.create({
    data: {
      id: generate("ssoauth").toString(),
      organizationId,
      connectionId,
      userId: user,
      authenticatedAt,
    },
  });
}

async function domainOwner(organizationId: string, connectionId: string) {
  await prisma.$transaction([
    prisma.ssoVerifiedDomainHolder.deleteMany({ where: { domain } }),
    prisma.ssoVerifiedDomain.update({
      where: { domain },
      data: { organizationId },
    }),
    prisma.ssoVerifiedDomainHolder.create({
      data: { domain, organizationId, connectionId },
    }),
  ]);
}

async function sync(connectionId: string, state: string) {
  await prisma.scimSyncState.create({
    data: {
      id: connectionId,
      organizationId,
      connectionId,
      state,
      occurredAt: MIGRATION_STARTED_AT,
      lastEventId: `event-${connectionId}`,
      acceptedAt: MIGRATION_STARTED_AT,
      projectionVersion: "test",
      createdAt: MIGRATION_STARTED_AT,
      updatedAt: MIGRATION_STARTED_AT,
    },
  });
}

beforeEach(async () => {
  holdsPassword.mockResolvedValue(true);
  recovery.hasLiveBinding.mockResolvedValue(true);
  await prisma.organization.createMany({
    data: organizationIds.map((id) => ({ id, name: id, slug: id })),
  });
  await prisma.ssoConnection.createMany({
    data: [
      migrationConnectionData({ id: legacyId, organizationId, domain }),
      migrationConnectionData({
        id: directId,
        organizationId,
        domain,
        replacesConnectionId: legacyId,
      }),
    ],
  });
  const admin = await member("admin");
  await identifier({ name: "admin", user: admin });
  await authentication(directId, admin, MIGRATION_STARTED_AT);
  await prisma.ssoBreakGlassBinding.create({
    data: {
      id: `${namespace}-recovery`,
      organizationId,
      userId: admin,
      grantedByUserId: admin,
      grantedAt: MIGRATION_STARTED_AT,
      expiresAt: new Date("2026-10-01T00:00:00.000Z"),
      warnedDays: [],
    },
  });
  await prisma.ssoVerifiedDomain.create({ data: { domain, organizationId } });
  await prisma.ssoVerifiedDomainHolder.create({
    data: { domain, organizationId, connectionId: directId },
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.ssoVerifiedDomainHolder.deleteMany({ where: { domain } });
  await prisma.ssoVerifiedDomain.deleteMany({ where: { domain } });
  await prisma.identifier.deleteMany({
    where: { id: { startsWith: `${namespace}-identifier-` } },
  });
  await prisma.account.deleteMany({
    where: { userId: { startsWith: `${namespace}-` } },
  });
  await prisma.ssoAuthenticationActivity.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.ssoBreakGlassBinding.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.scimToken.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.scimSyncState.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.ssoConnection.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { startsWith: `${namespace}-` } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds } },
  });
});
afterAll(async () => prisma.$disconnect());

describe("given persisted migration evidence", () => {
  it("preserves the ready checklist and independently verifies finalization", async () => {
    expect(await progress()).toEqual({
      legacy: {
        connectionId: legacyId,
        source: "legacy-grandfathered",
        providerId: "waad|acme",
      },
      replacement: {
        connectionId: directId,
        source: "self-serve",
        providerId: "direct",
      },
      phase: "GRACE_DIRECT",
      selectedRoute: "direct",
      inheritedDomains: [
        {
          domain,
          method: "dns-txt",
          proofState: "PRESENT",
          evidenceRef: "sha256:proof",
          verifiedAtMs: MIGRATION_STARTED_AT.getTime(),
        },
      ],
      testSignIn: { done: true, atMs: MIGRATION_STARTED_AT.getTime() },
      members: {
        activeCount: 1,
        linkedCount: 1,
        stragglers: [],
        nextCursor: null,
      },
      quietPeriod: { lastLegacyAuthenticationAtMs: null, complete: true },
      scim: { status: "not-applicable" },
      blockers: [],
      canFinalize: true,
    });
    expect(await inspect()).toEqual({
      legacyConnectionId: legacyId,
      legacyState: "ACTIVE",
      phase: "GRACE_DIRECT",
      blockers: [],
      legacyAccessRetired: true,
    });
  });

  it("pages active unlinked members and keeps linked identities distinct from verified ones", async () => {
    const linked = await member("attached");
    const alpha = await member("straggler-a");
    const beta = await member("straggler-b");
    const disabled = await member("disabled", { disabled: true });
    const foreign = await member("foreign", {
      organizationId: otherOrganizationId,
    });
    await identifier({ name: "attached", user: linked, state: "ATTACHED" });
    await identifier({
      name: "duplicate",
      user: userId("admin"),
      state: "PRIMARY",
    });
    await identifier({ name: "disabled", user: disabled });
    await identifier({ name: "foreign", user: foreign });
    await authentication(legacyId, alpha, new Date("2026-09-02T00:00:00.000Z"));
    const latest = new Date("2026-09-03T00:00:00.000Z");
    await authentication(legacyId, alpha, latest);

    const first = await progress(null, 1);
    expect(first?.members).toEqual({
      activeCount: 4,
      linkedCount: 2,
      nextCursor: alpha,
      stragglers: [
        {
          userId: alpha,
          name: "straggler-a",
          email: `${alpha}@example.test`,
          lastLegacyAuthenticationAtMs: latest.getTime(),
        },
      ],
    });
    expect((await progress(alpha, 1))?.members).toEqual({
      activeCount: 4,
      linkedCount: 2,
      nextCursor: null,
      stragglers: [
        {
          userId: beta,
          name: "straggler-b",
          email: `${beta}@example.test`,
          lastLegacyAuthenticationAtMs: null,
        },
      ],
    });
    expect((await inspect())?.blockers.map(({ code }) => code)).toEqual([
      "members-not-linked",
      "members-not-verified-on-replacement",
    ]);
    await identifier({ name: "straggler-a", user: alpha });
    await identifier({ name: "straggler-b", user: beta });
    expect((await progress())?.blockers).toEqual([]);
    expect((await inspect())?.blockers.map(({ code }) => code)).toEqual([
      "members-not-verified-on-replacement",
    ]);
  });

  it("does not resolve another organization's pair or a cross-organization predecessor", async () => {
    await expect(
      repository.getProgress({
        organizationId: otherOrganizationId,
        connectionId: directId,
        cursor: null,
        limit: 25,
      }),
    ).resolves.toBeNull();
    await expect(
      repository.inspect({
        organizationId: otherOrganizationId,
        replacementConnectionId: directId,
      }),
    ).resolves.toBeNull();
    await prisma.ssoConnection.update({
      where: { id: legacyId },
      data: { organizationId: otherOrganizationId },
    });
    expect(await progress()).toBeNull();
    expect(await inspect()).toBeNull();
  });

  it("requires ownership in this organization as well as a qualified proof and holder", async () => {
    await prisma.ssoConnection.create({
      data: migrationConnectionData({
        id: foreignLegacyId,
        organizationId: otherOrganizationId,
        domain,
      }),
    });
    await domainOwner(otherOrganizationId, foreignLegacyId);
    expect((await inspect())?.blockers.map(({ code }) => code)).toContain(
      "domain-ownership-proof-missing",
    );
    await domainOwner(organizationId, directId);
    await prisma.ssoConnection.update({
      where: { id: directId },
      data: {
        domainVerifications: [
          {
            domain,
            method: "dns-txt",
            actorId: null,
            verifiedAtMs: MIGRATION_STARTED_AT.getTime(),
            proofState: "LAPSED",
            tokenHash: "sha256:proof",
          },
        ],
      },
    });
    expect((await progress())?.inheritedDomains).toEqual([]);
    expect((await inspect())?.blockers.map(({ code }) => code)).toContain(
      "domain-ownership-proof-missing",
    );
  });

  it("reloads operational evidence for finalization without loading a UI member page", async () => {
    expect((await progress())?.canFinalize).toBe(true);
    await authentication(legacyId, userId("admin"), MIGRATION_NOW);
    const people = vi.spyOn(prisma.user, "findMany");
    const pageActivity = vi.spyOn(prisma.ssoAuthenticationActivity, "findMany");

    expect((await inspect())?.blockers.map(({ code }) => code)).toContain(
      "legacy-activity-not-quiet",
    );
    expect(people).not.toHaveBeenCalled();
    expect(pageActivity).not.toHaveBeenCalled();
  });

  it("keeps disabled members' legacy accounts pending retirement and accepts detached association evidence", async () => {
    const disabled = await member("disabled", { disabled: true });
    const accountId = `${namespace}-account-disabled`;
    await prisma.account.create({
      data: {
        id: accountId,
        userId: disabled,
        provider: "auth0",
        providerAccountId: "waad|acme|disabled",
      },
    });
    await identifier({
      name: "disabled-legacy",
      user: disabled,
      state: "DETACHED",
      connectionId: legacyId,
      accountId,
    });

    expect((await progress())?.members.activeCount).toBe(1);
    expect(await inspect()).toMatchObject({
      blockers: [],
      legacyAccessRetired: false,
    });
    await prisma.account.delete({ where: { id: accountId } });
    expect((await inspect())?.legacyAccessRetired).toBe(true);
  });

  it("requires account association and blocks a matching legacy provider shared through membership", async () => {
    const accountId = `${namespace}-account-admin`;
    await prisma.account.create({
      data: {
        id: accountId,
        userId: userId("admin"),
        provider: "auth0",
        providerAccountId: "waad|acme|admin",
      },
    });
    expect((await inspect())?.blockers.map(({ code }) => code)).toContain(
      "legacy-account-association-ambiguous",
    );
    await identifier({
      name: "admin-legacy",
      user: userId("admin"),
      connectionId: legacyId,
      accountId,
    });
    await prisma.ssoConnection.create({
      data: migrationConnectionData({
        id: foreignLegacyId,
        organizationId: otherOrganizationId,
        domain: `other.${domain}`,
      }),
    });
    expect((await inspect())?.blockers).toEqual([]);
    await prisma.organizationUser.create({
      data: {
        userId: userId("admin"),
        organizationId: otherOrganizationId,
        role: "MEMBER",
      },
    });
    expect((await inspect())?.blockers.map(({ code }) => code)).toEqual([
      "shared-legacy-identifiers",
      "legacy-provider-ambiguous",
    ]);
    await prisma.ssoConnection.update({
      where: { id: foreignLegacyId },
      data: { idpMetadata: { providerId: "waad|another" } },
    });
    expect((await inspect())?.blockers.map(({ code }) => code)).toEqual([
      "shared-legacy-identifiers",
    ]);
  });

  it("keeps directory readiness and legacy token retirement as separate facts", async () => {
    await sync(legacyId, "SYNCING");
    expect((await progress())?.scim.status).toBe("needs-repointing");
    await sync(directId, "SYNCING");
    await prisma.scimToken.create({
      data: {
        id: `${namespace}-token`,
        organizationId,
        connectionId: legacyId,
        hashedToken: namespace,
      },
    });

    expect((await progress())?.scim.status).toBe("ready");
    expect(await inspect()).toMatchObject({
      blockers: [],
      legacyAccessRetired: false,
    });
    await prisma.scimToken.delete({ where: { id: `${namespace}-token` } });
    expect((await inspect())?.legacyAccessRetired).toBe(true);
  });

  it("requires usable recovery even when a binding row exists and deduplicates its blocker", async () => {
    holdsPassword.mockResolvedValue(false);
    recovery.hasLiveBinding.mockResolvedValue(false);
    expect((await progress())?.blockers.map(({ code }) => code)).toEqual([
      "recovery-path-missing",
    ]);
    expect((await inspect())?.blockers.map(({ code }) => code)).toEqual([
      "recovery-path-missing",
    ]);
  });

  /** @scenario "Migration progress recognizes native identifiers without connection annotations" */
  it("counts the native direct binding produced without a connection annotation", async () => {
    const nativeAccount = await prisma.account.create({
      data: {
        userId: userId("admin"),
        provider: directId,
        providerAccountId: "signed-subject",
      },
    });
    await prisma.identifier.update({
      where: { id: `${namespace}-identifier-admin` },
      data: {
        connectionId: null,
        accountId: nativeAccount.id,
        providerId: directId,
        providerAccountId: "signed-subject",
      },
    });

    expect((await progress())?.members).toMatchObject({
      activeCount: 1,
      linkedCount: 1,
      stragglers: [],
    });
    expect((await inspect())?.blockers).toEqual([]);

    await prisma.identifier.update({
      where: { id: `${namespace}-identifier-admin` },
      data: { connectionId: "explicit-other-connection" },
    });
    expect((await progress())?.members.linkedCount).toBe(0);
    expect((await inspect())?.blockers.map(({ code }) => code)).toContain(
      "members-not-verified-on-replacement",
    );
  });

  /** @scenario "Legacy adoption evidence keeps sibling providers separate" */
  it("associates adopted Auth0 account facts while keeping sibling connections separate", async () => {
    const account = await prisma.account.create({
      data: {
        userId: userId("admin"),
        provider: "auth0",
        providerAccountId: "waad|acme|admin",
      },
    });
    await identifier({
      name: "adopted-legacy",
      user: userId("admin"),
      connectionId: legacyId,
      accountId: account.id,
    });
    await prisma.identifier.update({
      where: { id: `${namespace}-identifier-adopted-legacy` },
      data: {
        connectionId: null,
        providerId: "auth0",
        providerAccountId: "waad|acme|admin",
      },
    });

    expect(await inspect()).toMatchObject({
      blockers: [],
      legacyAccessRetired: false,
    });
    await prisma.identifier.update({
      where: { id: `${namespace}-identifier-adopted-legacy` },
      data: { providerAccountId: "waad|acme-other|admin" },
    });
    expect((await inspect())?.blockers.map(({ code }) => code)).toContain(
      "legacy-account-association-ambiguous",
    );
  });

  for (const replacementAvailable of [true, false]) {
    /** @scenario "Native legacy retirement requires a usable replacement in the same organization" */
    it(`${replacementAvailable ? "retires" : "refuses retirement of"} adopted legacy bindings with ${replacementAvailable ? "a verified" : "no"} native replacement`, async () => {
      const ownerId = userId("admin");
      const foreignId = await member("foreign", {
        organizationId: otherOrganizationId,
      });
      const ownAccount = await prisma.account.create({
        data: {
          userId: ownerId,
          provider: "auth0",
          providerAccountId: "waad|acme|admin",
        },
      });
      const foreignAccount = await prisma.account.create({
        data: {
          userId: foreignId,
          provider: "auth0",
          providerAccountId: "waad|acme|foreign",
        },
      });
      const directAccount = await prisma.account.create({
        data: {
          userId: ownerId,
          provider: replacementAvailable ? directId : "another-provider",
          providerAccountId: "waad|acme|admin",
        },
      });
      for (const [name, account] of [
        ["retire-own", ownAccount],
        ["retire-foreign", foreignAccount],
      ] as const) {
        await prisma.identifier.create({
          data: {
            id: `${namespace}-identifier-${name}`,
            userId: account.userId,
            accountId: account.id,
            provider: "oidc",
            providerId: account.provider,
            providerAccountId: account.providerAccountId,
            state: "VERIFIED",
            connectionId: null,
            attachedAt: MIGRATION_STARTED_AT,
          },
        });
      }
      await prisma.identifier.update({
        where: { id: `${namespace}-identifier-admin` },
        data: {
          connectionId: null,
          accountId: directAccount.id,
          providerId: directAccount.provider,
          providerAccountId: directAccount.providerAccountId,
        },
      });
      const identity = identityService();
      const accounts = identityCeremonies();
      const detach = vi
        .spyOn(identity, "detachIdentifier")
        .mockResolvedValue([]);
      const beforeDelete = vi
        .spyOn(accounts, "beforeAccountDelete")
        .mockResolvedValue(void 0);
      const revokeForConnection = vi.fn(async () => ({ revoked: 0 }));
      const retirement = new PrismaSsoLegacyIdentityRetirement({
        prisma,
        identity,
        accounts,
        directories: { revokeForConnection },
        now: () => MIGRATION_NOW.getTime(),
        newCommandId: () => "retire-binding",
      });
      const action = retirement.retire({
        organizationId,
        legacyConnectionId: legacyId,
        replacementConnectionId: directId,
        actorUserId: ownerId,
      });

      if (!replacementAvailable) {
        await expect(action).rejects.toMatchObject({
          code: "sso_migration_finalization_blocked",
        });
        expect(
          await prisma.account.findUnique({ where: { id: ownAccount.id } }),
        ).not.toBeNull();
        expect(beforeDelete).not.toHaveBeenCalled();
        expect(detach).not.toHaveBeenCalled();
        expect(revokeForConnection).not.toHaveBeenCalled();
      } else {
        await action;
        expect(
          await prisma.account.findUnique({ where: { id: ownAccount.id } }),
        ).toBeNull();
        expect(beforeDelete).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ id: ownAccount.id, userId: ownerId }),
        );
        expect(detach).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            identifierId: `${namespace}-identifier-retire-own`,
            userId: ownerId,
          }),
        );
        expect(revokeForConnection).toHaveBeenCalledExactlyOnceWith({
          organizationId,
          connectionId: legacyId,
        });
      }
      expect(
        await prisma.account.findUnique({ where: { id: foreignAccount.id } }),
      ).not.toBeNull();
      expect(
        await prisma.account.findUnique({ where: { id: directAccount.id } }),
      ).not.toBeNull();
    });
  }
});
