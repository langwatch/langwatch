import { IdentitySecretCarryService } from "@langwatch/identity-server";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaIdentitySecretCarryRepository } from "../identity-secret-carry.prisma.repository";

/**
 * The latch's secret carry, against Postgres (ADR-116 §4).
 *
 * Two of its three claims can only be proved here, because they are claims
 * about the DATABASE rather than about the decision: that the copy preserves
 * the `Account` row's own timestamps, and that running it again inserts
 * nothing. The service's own unit suite proves which rows it picks; this
 * proves what actually lands.
 *
 * The timestamp claim is the one with teeth. `AccountCredential.updatedAt`
 * is `@updatedAt`, so a naive copy stamps it `now()` — the credential row
 * then claims to be newer than the secret it holds, and the reverse heal leg
 * never fires for that account again. A password changed on the legacy
 * branch during the gate's cache window would be rejected forever, silently.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
const namespace = `idcarry-${nanoid(8)}`;
const USER = `${namespace}-user`;
const CREDENTIAL_ACCOUNT = `${namespace}-acc-credential`;
const GOOGLE_ACCOUNT = `${namespace}-acc-google`;

const ACCOUNT_CREATED_AT = new Date(1_690_000_000_000);
const ACCOUNT_UPDATED_AT = new Date(1_690_000_500_000);

const carry = new IdentitySecretCarryService(
  new PrismaIdentitySecretCarryRepository(prisma),
);

async function seedLegacyUser(): Promise<void> {
  await prisma.user.create({
    data: { id: USER, email: `${USER}@acme.com`, emailVerified: true },
  });
  await prisma.account.create({
    data: {
      id: CREDENTIAL_ACCOUNT,
      userId: USER,
      provider: "credential",
      // better-auth 1.7 keys an account by `(issuer, accountId)`; the local
      // credential provider's issuer is `local:credential`, not
      // `local:oauth:credential`. Without it sign-in cannot find this row.
      issuer: "local:credential",
      providerAccountId: USER,
      password: "hashed-legacy-password",
      createdAt: ACCOUNT_CREATED_AT,
      updatedAt: ACCOUNT_UPDATED_AT,
    },
  });
  await prisma.account.create({
    data: {
      id: GOOGLE_ACCOUNT,
      userId: USER,
      provider: "google",
      // Google declares a real issuer of its own, so this is NOT the
      // synthetic `local:oauth:google` the other providers get.
      issuer: "https://accounts.google.com",
      providerAccountId: "g-1",
      access_token: "at-1",
      refresh_token: "rt-1",
      id_token: "it-1",
      expires_at: new Date(1_690_000_900_000),
      scope: "openid email",
      createdAt: ACCOUNT_CREATED_AT,
      updatedAt: ACCOUNT_UPDATED_AT,
    },
  });
}

afterEach(async () => {
  await prisma.accountCredential.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("carrying a latching user's secrets into AccountCredential", () => {
  describe("given a user whose Account rows hold a password and provider tokens", () => {
    describe("when the user's backfill finalizes", () => {
      /** @scenario "Finalizing an existing user carries their secrets across once" */
      it("copies each row's secrets across once, preserving the Account row's own timestamps", async () => {
        await seedLegacyUser();

        const first = await carry.carryForUser({ userId: USER });

        expect(first).toEqual({ carried: 2, healed: 0 });
        const credentials = await prisma.accountCredential.findMany({
          where: { userId: USER },
          orderBy: { id: "asc" },
        });
        expect(credentials.map((row) => row.id).sort()).toEqual(
          [CREDENTIAL_ACCOUNT, GOOGLE_ACCOUNT].sort(),
        );

        const password = credentials.find(
          (row) => row.id === CREDENTIAL_ACCOUNT,
        );
        expect(password?.password).toBe("hashed-legacy-password");
        expect(password?.provider).toBe("credential");

        // The NextAuth column names are renamed across the copy; the values
        // are not.
        const google = credentials.find((row) => row.id === GOOGLE_ACCOUNT);
        expect(google).toMatchObject({
          provider: "google",
          accessToken: "at-1",
          refreshToken: "rt-1",
          idToken: "it-1",
          scope: "openid email",
        });
        expect(google?.accessTokenExpiresAt?.getTime()).toBe(1_690_000_900_000);

        // The timestamps are the Account row's, not the copy's. Anything
        // else makes the credential row claim to be newer than the secret it
        // holds, and the reverse heal leg never fires for it again.
        for (const credential of credentials) {
          expect(credential.createdAt.getTime()).toBe(
            ACCOUNT_CREATED_AT.getTime(),
          );
          expect(credential.updatedAt.getTime()).toBe(
            ACCOUNT_UPDATED_AT.getTime(),
          );
        }

        // Running it again inserts nothing, and changes nothing.
        const second = await carry.carryForUser({ userId: USER });
        expect(second).toEqual({ carried: 0, healed: 0 });
        const unchanged = await prisma.accountCredential.findMany({
          where: { userId: USER },
          orderBy: { id: "asc" },
        });
        expect(unchanged).toEqual(credentials);
      });
    });

    describe("when a password later lands on the legacy branch", () => {
      it("heals the newer Account secret back onto the credential row", async () => {
        await seedLegacyUser();
        await carry.carryForUser({ userId: USER });

        const changedAt = new Date(ACCOUNT_UPDATED_AT.getTime() + 60_000);
        await prisma.account.update({
          where: { id: CREDENTIAL_ACCOUNT },
          data: { password: "hashed-new-password", updatedAt: changedAt },
        });

        expect(await carry.carryForUser({ userId: USER })).toEqual({
          carried: 0,
          healed: 1,
        });
        const healed = await prisma.accountCredential.findUnique({
          where: { id: CREDENTIAL_ACCOUNT },
        });
        expect(healed?.password).toBe("hashed-new-password");
        // The Account row's time rides along, so the comparison settles and
        // the next pass writes nothing.
        expect(healed?.updatedAt.getTime()).toBe(changedAt.getTime());
        expect(await carry.carryForUser({ userId: USER })).toEqual({
          carried: 0,
          healed: 0,
        });
      });
    });
  });
});
