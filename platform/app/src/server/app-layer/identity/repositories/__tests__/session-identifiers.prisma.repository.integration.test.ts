import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { PrismaSessionIdentifiers } from "~/server/app-layer/identity/session-adapters";
import { prisma } from "~/server/db";

const namespace = `session-identifiers-${nanoid(8)}`;
const userId = `${namespace}-user`;
const identifiers = new PrismaSessionIdentifiers(prisma);

async function addEnterpriseIdentifier({
  id,
  providerId,
  providerAccountId,
}: {
  id: string;
  providerId: string;
  providerAccountId: string;
}) {
  await prisma.identifier.create({
    data: {
      id,
      userId,
      provider: "oidc",
      providerId,
      providerAccountId,
      issuer: `local:oauth:${providerId}`,
      value: `${namespace}@acme.test`,
      domain: "acme.test",
      identifierHash: null,
      accountId: `${id}-account`,
      state: "VERIFIED",
      connectionId: null,
      verifiedAt: new Date(),
      attachedAt: new Date(),
      detachedAt: null,
    },
  });
}

afterEach(async () => {
  await prisma.identifier.deleteMany({ where: { userId } });
});

describe("the identifier recorded on an enterprise callback session", () => {
  /** @scenario An enterprise callback records the exact accepted account */
  it("uses Auth0's verbatim provider and subject instead of the folded vocabulary", async () => {
    await addEnterpriseIdentifier({
      id: `${namespace}-auth0`,
      providerId: "auth0",
      providerAccountId: "auth0|sam",
    });

    await expect(
      identifiers.findIdentifierIdFor({
        userId,
        providerId: "auth0",
        providerAccountId: "auth0|sam",
      }),
    ).resolves.toBe(`${namespace}-auth0`);
  });

  /** @scenario An enterprise callback records the exact accepted account */
  it("keeps Auth0 and Okta sessions separately revocable when subjects overlap", async () => {
    await addEnterpriseIdentifier({
      id: `${namespace}-auth0`,
      providerId: "auth0",
      providerAccountId: "shared-subject",
    });
    await addEnterpriseIdentifier({
      id: `${namespace}-okta`,
      providerId: "okta",
      providerAccountId: "shared-subject",
    });

    await expect(
      Promise.all([
        identifiers.findIdentifierIdFor({
          userId,
          providerId: "auth0",
          providerAccountId: "shared-subject",
        }),
        identifiers.findIdentifierIdFor({
          userId,
          providerId: "okta",
          providerAccountId: "shared-subject",
        }),
      ]),
    ).resolves.toEqual([`${namespace}-auth0`, `${namespace}-okta`]);
  });
});
