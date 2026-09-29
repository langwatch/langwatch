import {
  type IdentifierLifecycleState,
  type IdentifierProvider,
  type SsoConnectionLifecycleState,
  SsoConnectionNotFoundError,
} from "@langwatch/identity";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { newSsoConnectionId } from "../sso-connection-id";
import { PrismaSsoConnectionStrandingRepository } from "../sso-connection-reads.prisma.repository";

const namespace = `sso-stranding-${nanoid(8)}`;
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other-org`;
const connectionId = `${namespace}-connection`;
const otherConnectionId = `${namespace}-other-connection`;
const memberId = `${namespace}-member`;
const unrelatedId = `${namespace}-unrelated`;
const organizationIds = [organizationId, otherOrganizationId];
const repository = new PrismaSsoConnectionStrandingRepository(prisma);

beforeEach(async () => {
  await prisma.organization.createMany({
    data: organizationIds.map((id) => ({ id, name: id, slug: id })),
  });
  await prisma.user.createMany({
    data: [memberId, unrelatedId].map((id) => ({
      id,
      email: `${id}@example.test`,
    })),
  });
  await prisma.organizationUser.createMany({
    data: [
      { userId: memberId, organizationId, role: "MEMBER" },
      {
        userId: unrelatedId,
        organizationId: otherOrganizationId,
        role: "MEMBER",
      },
    ],
  });
  await storedConnection(connectionId, organizationId, "ACTIVE");
});

async function storedConnection(
  id: string,
  organizationId: string,
  state: SsoConnectionLifecycleState,
) {
  const now = new Date();
  await prisma.ssoConnection.create({
    data: {
      id,
      organizationId,
      type: "oidc",
      state,
      claimedDomains: [],
      approvedDomains: [],
      verifiedDomains: [],
      lapsedDomains: [],
      idpMetadata: { providerId: "oidc" },
      source: "self-serve",
      occurredAt: now,
      lastEventId: `${namespace}-event`,
      acceptedAt: now,
      projectionVersion: "test",
      createdAt: now,
      updatedAt: now,
    },
  });
}

afterEach(async () => {
  await prisma.identifier.deleteMany({
    where: { userId: { in: [memberId, unrelatedId] } },
  });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [memberId, unrelatedId] } },
  });
  await prisma.ssoConnection.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds } },
  });
});

async function identifier({
  userId = memberId,
  provider = "oidc",
  state = "VERIFIED",
  boundConnectionId = connectionId,
  providerId = connectionId,
  providerAccountId = nanoid(),
}: {
  userId?: string;
  provider?: IdentifierProvider;
  state?: IdentifierLifecycleState;
  boundConnectionId?: string | null;
  providerId?: string | null;
  providerAccountId?: string | null;
} = {}) {
  return await prisma.identifier.create({
    data: {
      id: `${namespace}-${nanoid()}`,
      userId,
      provider,
      state,
      connectionId: boundConnectionId,
      providerId,
      providerAccountId,
      attachedAt: new Date(),
      verifiedAt:
        state === "VERIFIED" || state === "PRIMARY" ? new Date() : null,
    },
  });
}

describe("PrismaSsoConnectionStrandingRepository", () => {
  /** @scenario "Teardown cannot assume safety when the connection projection is missing" */
  it("refuses to assess a connection whose projection is unavailable", async () => {
    await identifier();
    await prisma.ssoConnection.delete({ where: { id: connectionId } });

    await expect(
      repository.findStrandedUserIds({ connectionId }),
    ).rejects.toBeInstanceOf(SsoConnectionNotFoundError);
  });

  /** @scenario "Teardown recognizes adopted native sign-in methods without a connection annotation" */
  it("finds the native provider binding alongside its unverified address", async () => {
    await identifier({ boundConnectionId: null });
    await identifier({
      provider: "email",
      state: "ATTACHED",
      boundConnectionId: null,
      providerId: null,
      providerAccountId: null,
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([
      memberId,
    ]);
  });

  /** @scenario "A verified local credential remains a way in after connection teardown" */
  it("counts a local credential whose connection annotation is null", async () => {
    await identifier();
    await identifier({
      provider: "credential",
      boundConnectionId: null,
      providerId: "credential",
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([]);
  });

  /** @scenario "An address or unverified method cannot make connection teardown safe" */
  it.each([
    { provider: "email", state: "ATTACHED" },
    { provider: "email", state: "VERIFIED" },
    { provider: "email", state: "PRIMARY" },
    { provider: "credential", state: "ATTACHED" },
    { provider: "oidc", state: "ATTACHED" },
    { provider: "passkey", state: "DEAD_END" },
    { provider: "passkey", state: "DETACHED" },
  ] satisfies {
    provider: IdentifierProvider;
    state: IdentifierLifecycleState;
  }[])("rejects $state $provider as a fallback", async ({
    provider,
    state,
  }) => {
    await identifier();
    await identifier({
      provider,
      state,
      boundConnectionId: otherConnectionId,
      providerId: otherConnectionId,
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([
      memberId,
    ]);
  });

  /** @scenario "Another verified authentication method prevents connection stranding" */
  it.each([
    {
      provider: "passkey",
      state: "VERIFIED",
      providerId: null,
      boundConnectionId: null,
    },
    {
      provider: "google",
      state: "VERIFIED",
      providerId: "google",
      boundConnectionId: null,
    },
    {
      provider: "oidc",
      state: "PRIMARY",
      providerId: otherConnectionId,
      boundConnectionId: null,
    },
    {
      provider: "oidc",
      state: "VERIFIED",
      providerId: otherConnectionId,
      boundConnectionId: otherConnectionId,
    },
  ] satisfies {
    provider: IdentifierProvider;
    state: IdentifierLifecycleState;
    providerId: string | null;
    boundConnectionId: string | null;
  }[])("accepts $state $provider outside the removed connection", async (alternative) => {
    await storedConnection(otherConnectionId, otherOrganizationId, "ACTIVE");
    await identifier({ boundConnectionId: null });
    await identifier(alternative);

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([]);
  });

  /** @scenario "Another subject at the removed provider is not a fallback sign-in" */
  it("keeps a user stranded when both representations name the removed provider", async () => {
    await storedConnection(otherConnectionId, otherOrganizationId, "ACTIVE");
    await identifier();
    await identifier({ boundConnectionId: null });
    await identifier({ boundConnectionId: otherConnectionId });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([
      memberId,
    ]);
  });

  /** @scenario "An inactive SSO connection cannot be the alternate way in" */
  it.each(
    (["SUSPENDED", "TEARDOWN_PENDING", "TORN_DOWN", "DRAFT"] as const).flatMap(
      (state) => [
        { state, boundConnectionId: otherConnectionId },
        { state, boundConnectionId: null },
      ],
    ),
  )("rejects a $state alternative bound as $boundConnectionId", async ({
    state,
    boundConnectionId,
  }) => {
    await storedConnection(otherConnectionId, otherOrganizationId, state);
    await identifier();
    await identifier({ boundConnectionId, providerId: otherConnectionId });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([
      memberId,
    ]);
  });

  /** @scenario "An explicit missing SSO connection cannot be the alternate way in" */
  it.each([
    {
      boundConnectionId: otherConnectionId,
      provider: "google",
      providerId: "google",
    },
    {
      boundConnectionId: null,
      provider: "oidc",
      providerId: newSsoConnectionId(),
    },
  ] satisfies Array<{
    boundConnectionId: string | null;
    provider: IdentifierProvider;
    providerId: string;
  }>)("rejects a missing explicit connection through $provider", async ({
    boundConnectionId,
    provider,
    providerId,
  }) => {
    await identifier();
    await identifier({
      boundConnectionId,
      provider,
      providerId,
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([
      memberId,
    ]);
  });

  /** @scenario "Teardown does not strand unrelated or explicitly differently associated users" */
  it("ignores other providers, explicit sibling bindings and detached target identities", async () => {
    await identifier({
      userId: unrelatedId,
      boundConnectionId: null,
      providerId: otherConnectionId,
    });
    await identifier({ boundConnectionId: otherConnectionId });
    await identifier({ state: "DETACHED" });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([]);
  });

  /** @scenario "Teardown recognizes adopted legacy subjects without including another organization" */
  it("matches the legacy broker subject only among this organization's members", async () => {
    await prisma.ssoConnection.update({
      where: { id: connectionId },
      data: {
        source: "legacy-grandfathered",
        idpMetadata: { providerId: "waad|acme" },
      },
    });
    await identifier({
      boundConnectionId: null,
      providerId: "auth0",
      providerAccountId: "waad|acme|member",
    });
    await identifier({
      userId: unrelatedId,
      boundConnectionId: null,
      providerId: "auth0",
      providerAccountId: "waad|acme|unrelated",
    });
    await identifier({
      boundConnectionId: null,
      providerId: "auth0",
      providerAccountId: "waad|acme|alias",
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([
      memberId,
    ]);
  });
});
