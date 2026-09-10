/**
 * The three operations the API process's user directory used to refuse: the
 * address lookup and the two account mints. Passkey sign-up and directory
 * provisioning both run through them, so both were dead on this process while
 * the user module behind them still answered.
 */
import {
  BetterAuthAnnouncements,
  passkeySignUpRegistration,
  type PasskeySignUpDirectory,
  type SignUpVerification,
} from "@langwatch/auth-server";
import type { ScimUserProvisioning } from "@langwatch/enterprise-scim-server";
import { IdentityEventing } from "@langwatch/identity-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";
import { installApiUser } from "../user.composition.ts";

const NEW_ADDRESS = "newcomer@example.com";
const TAKEN_ADDRESS = "already@example.com";

/** One row per address this deployment already holds, plus what a mint writes. */
function testPrisma() {
  const rows = new Map<string, Record<string, unknown>>();
  const profile = (email: string, id: string) => ({
    id,
    name: null,
    email,
    emailVerified: false,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
  });
  rows.set(TAKEN_ADDRESS, profile(TAKEN_ADDRESS, "user-existing"));

  const accounts: Array<Record<string, unknown>> = [];
  const user = {
    findUnique: vi.fn(async ({ where }: { where: { email: string } }) => {
      return rows.get(where.email) ?? null;
    }),
    findFirst: vi.fn(async ({ where }: { where: { email: { equals: string } } }) => {
      return rows.get(where.email.equals) ?? null;
    }),
    create: vi.fn(
      async ({
        data,
        select,
      }: {
        data: { email: string; name?: string | null };
        select?: Record<string, boolean>;
      }) => {
        const row = profile(data.email, `user-${rows.size + 1}`);
        rows.set(data.email, row);
        return select
          ? Object.fromEntries(
              Object.keys(select).map((column) => [column, row[column as keyof typeof row]]),
            )
          : row;
      },
    ),
  };
  const account = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      accounts.push(data);
      return data;
    }),
  };

  const client = {
    user,
    account,
    $transaction: vi.fn(async (run: (transaction: unknown) => Promise<unknown>) =>
      run({ user, account }),
    ),
  };

  return { client: client as unknown as PrismaClient, user, account, accounts };
}

/** No event stack: nothing here spends an identifier command. */
class SilentEventing extends IdentityEventing {
  async tryPipelineCommand() {
    return null;
  }
}

/** Records the announcements without letting one fail the ceremony. */
class SilentAnnouncements extends BetterAuthAnnouncements {
  trackServerEvent(): void {}
  reportError(): void {}
  announceSignup(): void {}
  ssoAutoAddNurturing(): void {}
  sessionNurturing(): void {}
}

async function composeDirectory() {
  const prisma = testPrisma();
  const feature = await installApiUser({
    prisma: prisma.client,
    peers: {
      organizations: {} as unknown as OrganizationService,
      projects: { findIdentity: async () => null },
      resolveAuthProvider: async () => "email",
    },
    eventing: new SilentEventing(),
    rateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
    deployment: {},
    avatarStorage: { store: async () => ({ id: "avatar" }) },
    avatarObjects: { findById: async () => null },
    processName: "langwatch-api",
  });

  return { directory: feature.app, prisma };
}

/** The plugin context the two callbacks carry through without reading. */
const pluginContext = () =>
  ({
    ctx: { context: { internalAdapter: {} } },
  }) as never;

function passkeyCeremony(users: PasskeySignUpDirectory) {
  const requestVerification = vi.fn(async () => {});
  const verification: SignUpVerification = { requestVerification };
  const registration = passkeySignUpRegistration({
    announcements: new SilentAnnouncements(),
    handleSecret: "test-secret",
    users,
    verification,
  });

  return { registration, requestVerification };
}

describe("given the API process's user directory composed on its own connection", () => {
  describe("when a passkey ceremony signs somebody up", () => {
    /** @scenario A passkey ceremony mints its account through the process's directory */
    it("mints the account the ceremony registers its key against", async () => {
      const { directory, prisma } = await composeDirectory();
      const { registration } = passkeyCeremony(directory);

      const created = await registration.afterVerification({
        ...pluginContext(),
        context: NEW_ADDRESS,
      });

      expect(created.userId).toBe("user-2");
      expect(created.name).toBe(NEW_ADDRESS);
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: NEW_ADDRESS }) }),
      );
      expect(prisma.accounts).toHaveLength(1);
    });

    /** @scenario A passkey ceremony is refused for an address that already has an account */
    it("refuses an address somebody already holds, before minting anything", async () => {
      const { directory, prisma } = await composeDirectory();
      const { registration } = passkeyCeremony(directory);

      await expect(
        registration.resolveUser({ ...pluginContext(), context: TAKEN_ADDRESS }),
      ).rejects.toThrow(/already has an account/);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("when a directory push names somebody the deployment does not know", () => {
    /** @scenario A directory push mints an account through the process's directory */
    it("looks the address up through the directory and mints the account", async () => {
      const { directory, prisma } = await composeDirectory();
      const provisioning: ScimUserProvisioning = directory;

      expect(await provisioning.findByEmail({ email: NEW_ADDRESS })).toBeNull();
      const minted = await provisioning.create({ name: "Newcomer", email: NEW_ADDRESS });

      expect(minted.email).toBe(NEW_ADDRESS);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });
  });
});
