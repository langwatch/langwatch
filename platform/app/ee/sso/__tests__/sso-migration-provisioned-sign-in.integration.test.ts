// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 *
 * A person the previous connection's directory sync provisioned, who has
 * never signed in, has no verified address and no account. Their sign-in
 * through the replacement passes two gates that both used to refuse them:
 * the provisioned-user resolver, which only looked for the replacement's own
 * directory rows, and the update's link policy, which refused any unverified
 * address. The update cannot finish until every member has signed in through
 * the replacement, so refusing them was a deadlock for every organization
 * whose people arrive through directory sync.
 *
 * Spec: specs/identity/sso-idp-termination.feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { SSOUserResolutionInput } from "@better-auth/sso";
import { PrismaScimSsoUsers } from "@ee/scim/scim-sso-user.prisma.repository";
import { generate } from "@langwatch/ksuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";
import { PrismaClient } from "~/generated/prisma/client";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import { PrismaSsoMigrationCallbackPolicy } from "../sso-migration-callback-policy.prisma.repository";
import { migrationConnectionData } from "./sso-migration-evidence.fixture";

const namespace = generate("ssoprov").toString();
const organizationId = `${namespace}-org`;
const legacyId = `${namespace}-legacy`;
const directId = `${namespace}-direct`;
const domain = `${namespace.toLowerCase()}.test`;
const provisionedId = `${namespace}-sam`;
const unprovisionedId = `${namespace}-pat`;
const email = (user: string) => `${user}@${domain}`;

const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const transactions = new AsyncLocalStorage<Prisma.TransactionClient>();
const resolver = PrismaScimSsoUsers.create(transactions);
const policy = new PrismaSsoMigrationCallbackPolicy(
  prisma,
  () => generate("ssoauth").toString(),
  { authenticatedAccountFor: async () => null },
);

function arrival(userId: string): SSOUserResolutionInput {
  return {
    protocol: "oidc",
    providerId: directId,
    accountKey: { issuer: `https://idp.${domain}`, accountId: `sub-${userId}` },
    providerUser: {
      id: `sub-${userId}`,
      email: email(userId),
      emailVerified: true,
      name: userId,
    },
    providerReference: {},
    providerClaims: {},
    verifiedIdTokenClaims: {},
  } as unknown as SSOUserResolutionInput;
}

const resolve = (userId: string) =>
  transactions.run(prisma as unknown as Prisma.TransactionClient, () =>
    resolver.resolve(arrival(userId)),
  );

const decide = (userId: string) =>
  policy.decideAccountLink({
    userId,
    providerId: directId,
    accountId: `sub-${userId}`,
  });

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: organizationId, name: organizationId, slug: organizationId },
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
  // The link policy only recognises a pair whose previous connection carries
  // the dialing facts of the provider LangWatch set up, and only lets an
  // address through on a domain the replacement holds a complete proof of.
  await prisma.ssoConnection.update({
    where: { id: legacyId },
    data: {
      idpMetadata: {
        issuer: null,
        providerId: "auth0",
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      },
    },
  });
  await prisma.ssoConnection.update({
    where: { id: directId },
    data: {
      domainVerifications: [
        {
          domain,
          method: "dns-txt",
          actorId: null,
          verifiedAtMs: Date.now(),
          proofState: "VERIFIED",
          firstAbsentAtMs: null,
          graceEndsAtMs: null,
          tokenHash: "sha256:proof",
        },
      ],
    },
  });
  // Both were created by a push, so neither address was ever verified.
  for (const userId of [provisionedId, unprovisionedId]) {
    await prisma.user.create({
      data: { id: userId, name: userId, email: email(userId) },
    });
    await prisma.organizationUser.create({
      data: { userId, organizationId, role: "MEMBER" },
    });
  }
  // Only one of them is something a directory sync of this pair vouches for.
  await prisma.scimDirectoryUser.create({
    data: { organizationId, connectionId: legacyId, userId: provisionedId },
  });
});

afterAll(async () => {
  await prisma.scimDirectoryUser.deleteMany({ where: { organizationId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({
    where: { id: { in: [provisionedId, unprovisionedId] } },
  });
  await prisma.ssoConnection.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe("given a person the previous connection's sync provisioned, who has never signed in", () => {
  describe("when they sign in through the replacement while the update is on", () => {
    // @scenario "A person the previous connection's sync provisioned can sign in through the replacement before the update finishes"
    it("is recognised as the person the directory means, on the previous connection's word", async () => {
      await expect(resolve(provisionedId)).resolves.toEqual({
        action: "link",
        userId: provisionedId,
        profile: "preserve",
      });
    });

    it("is let through the update's link policy although their address was never verified", async () => {
      await expect(decide(provisionedId)).resolves.toMatchObject({
        kind: "allow_replacement_pair",
        arrivalConnectionId: directId,
      });
    });
  });

  describe("when an unverified person nobody's directory vouches for signs in", () => {
    it("is still not linked on address alone", async () => {
      await expect(resolve(unprovisionedId)).resolves.toEqual({
        action: "continue",
      });
      await expect(decide(unprovisionedId)).resolves.toEqual({
        kind: "reject",
        code: "SSO_MIGRATION_LINK_UNVERIFIED",
      });
    });
  });
});
