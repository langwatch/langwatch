import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
/**
 * @vitest-environment node
 * Adoption by an address proof over the memory twins: what goes and what stays. Auth ends the
 * adopted account's sessions (modules/auth/specs/sign-up.feature).
 * @see modules/user/specs/user.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryUserCredentialRepository } from "../../repositories/memory/memory.user-signin-credential.repository.ts";
import { MemoryUserDatabase } from "../../repositories/memory/memory.user.database.ts";
import { MemoryUserRepository } from "../../repositories/memory/memory.user.repository.ts";
import type { UserAvatarStorage } from "../user-avatar-object.service.ts";
import { UserLifecycleNoticeService } from "../user-lifecycle-notice.service.ts";
import { UserService } from "../user.service.ts";

const EMAIL = "sam@acme.com";

async function unfinishedAccount({ signedIn = false }: { signedIn?: boolean } = {}) {
  const database = MemoryUserDatabase.create({
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const users = MemoryUserRepository.create({ database });
  const credentials = MemoryUserCredentialRepository.create({ database });
  const service = UserService.create({
    repository: users,
    organizations: createApiFixture<OrganizationApi>({}),
    auth: createApiFixture<AuthApi>({}),
    avatarStorage: createApiFixture<UserAvatarStorage>({}),
    credentialIssuer: "credential",
    platformOperators: createApiFixture<AuthzApi>({}),
    lifecycle: UserLifecycleNoticeService.create(),
  });
  const { id } = await users.createCredentialUser({
    name: "Sam",
    email: EMAIL,
    passwordHash: "chosen-before-the-proof",
    issuer: "credential",
    emailVerified: false,
  });
  database.writePasskey({ id: "passkey-1", userId: id });
  if (signedIn) await users.setLastLoginAt({ id, lastLoginAt: fromDate(new Date(1)) });

  return { id, users, credentials, service };
}

describe("given an account awaiting confirmation", () => {
  describe("when an address proof adopts it", () => {
    it("confirms it and drops its password and passkey", async () => {
      const { id, users, credentials, service } = await unfinishedAccount();

      await expect(service.adoptUnconfirmedAccount({ email: EMAIL })).resolves.toBe("adopted");

      expect((await users.findById(id))?.emailVerified).toBe(true);
      await expect(credentials.findLinkedAccounts({ userId: id })).resolves.toEqual([]);
      await expect(users.findPasskeyNudgeStatus(id)).resolves.toMatchObject({ hasPasskey: false });
    });
  });

  describe("when it has been signed into", () => {
    it("refuses as signed_in and keeps every method", async () => {
      const { id, users, credentials, service } = await unfinishedAccount({
        signedIn: true,
      });

      await expect(service.adoptUnconfirmedAccount({ email: EMAIL })).resolves.toBe("signed_in");

      expect((await users.findById(id))?.emailVerified).toBe(false);
      await expect(credentials.findLinkedAccounts({ userId: id })).resolves.toHaveLength(1);
      await expect(users.findPasskeyNudgeStatus(id)).resolves.toMatchObject({ hasPasskey: true });
    });
  });

  describe("when it was adopted once already", () => {
    it("refuses the second adoption as already_confirmed", async () => {
      const { service } = await unfinishedAccount();
      await service.adoptUnconfirmedAccount({ email: EMAIL });

      await expect(service.adoptUnconfirmedAccount({ email: EMAIL })).resolves.toBe(
        "already_confirmed",
      );
    });
  });
});

describe("given an address nobody holds", () => {
  it("answers no_account and touches nothing", async () => {
    const { service } = await unfinishedAccount();

    await expect(service.adoptUnconfirmedAccount({ email: "eve@acme.com" })).resolves.toBe(
      "no_account",
    );
  });
});
