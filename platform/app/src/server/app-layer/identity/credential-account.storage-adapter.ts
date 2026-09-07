import type { IdentityUserGate } from "@langwatch/identity-server";
import {
  type IdentityAccountsPort,
  type IdentityAccountWriter,
  issuerForProviderId,
} from "@langwatch/identity-server/better-auth";
import type {
  CreatedCredentialUser,
  CredentialAccountRecordsPort,
  CredentialAccountRow,
  LinkedAccount,
  SecureAccountFacts,
  UnlinkAttempt,
} from "./credential-account.service";

export interface CredentialAccountStorageAdapterDeps {
  legacy: CredentialAccountRecordsPort;
  identityAccounts: IdentityAccountsPort;
  identityWriter: IdentityAccountWriter;
  routesToIdentity: IdentityUserGate;
  newAccountId(): string;
  now(): Date;
}

export class CredentialAccountStorageConsistencyError extends Error {
  readonly name = "CredentialAccountStorageConsistencyError";
}

/**
 * Routes account-settings reads and mutations across the identity latch.
 *
 * The legacy repository remains byte-for-byte compatible for an unlatched
 * user. A latched user is read from `Identifier` joined to
 * `AccountCredential`, and every mutation goes through the same writer as
 * better-auth's storage adapter. That writer updates or removes the temporary
 * `Account` bridge before returning, so closing the gate cannot revive an old
 * password or an unlinked method.
 */
export class CredentialAccountStorageAdapter
  implements CredentialAccountRecordsPort
{
  private constructor(
    private readonly deps: CredentialAccountStorageAdapterDeps,
  ) {}

  static create(
    deps: CredentialAccountStorageAdapterDeps,
  ): CredentialAccountStorageAdapter {
    return new CredentialAccountStorageAdapter(deps);
  }

  async findLinkedAccounts({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LinkedAccount[]> {
    if (!(await this.deps.routesToIdentity({ userId }))) {
      return this.deps.legacy.findLinkedAccounts({ userId });
    }

    const rows = await this.deps.identityAccounts.findByUser({ userId });
    return rows.map((row) => ({
      id: row.id,
      provider: row.providerId,
      providerAccountId: row.accountId,
    }));
  }

  async findCredentialAccount({
    userId,
  }: {
    userId: string;
  }): Promise<CredentialAccountRow | null> {
    if (!(await this.deps.routesToIdentity({ userId }))) {
      return this.deps.legacy.findCredentialAccount({ userId });
    }

    const rows = await this.deps.identityAccounts.findByUser({ userId });
    const credential = rows.find((row) => row.providerId === "credential");
    return credential
      ? { id: credential.id, passwordHash: credential.password }
      : null;
  }

  async updateAccountPassword({
    userId,
    accountId,
    passwordHash,
  }: {
    userId: string;
    accountId: string;
    passwordHash: string;
  }): Promise<void> {
    if (!(await this.deps.routesToIdentity({ userId }))) {
      await this.deps.legacy.updateAccountPassword({
        userId,
        accountId,
        passwordHash,
      });
      return;
    }

    const rows = await this.deps.identityAccounts.findByAccountIds({
      accountIds: [accountId],
    });
    const owned = rows.filter((row) => row.userId === userId);
    if (owned.length !== 1) {
      throw new CredentialAccountStorageConsistencyError(
        "the credential account is not live for this user",
      );
    }
    await this.deps.identityWriter.applySecrets({
      rows: owned,
      secrets: { password: passwordHash },
    });
  }

  async createCredentialAccount({
    userId,
    passwordHash,
  }: {
    userId: string;
    passwordHash: string;
  }): Promise<void> {
    if (!(await this.deps.routesToIdentity({ userId }))) {
      await this.deps.legacy.createCredentialAccount({ userId, passwordHash });
      return;
    }

    const written = await this.deps.identityWriter.tryCreateCredential({
      account: {
        id: this.deps.newAccountId(),
        userId,
        providerId: "credential",
        issuer: issuerForProviderId("credential"),
        accountId: userId,
        createdAt: this.deps.now(),
      },
      userId,
      providerId: "credential",
      secrets: { password: passwordHash },
    });
    if (!written) {
      throw new CredentialAccountStorageConsistencyError(
        "the credential identifier could not be attached",
      );
    }
  }

  async deleteLinkedAccount({
    userId,
    accountId,
  }: {
    userId: string;
    accountId: string;
  }): Promise<UnlinkAttempt> {
    if (!(await this.deps.routesToIdentity({ userId }))) {
      return this.deps.legacy.deleteLinkedAccount({ userId, accountId });
    }

    const rows = await this.deps.identityAccounts.findByAccountIds({
      accountIds: [accountId],
    });
    const owned = rows.filter((row) => row.userId === userId);
    if (owned.length === 0) return "no_such_account";

    await this.deps.identityWriter.detach({ rows: owned });
    return "deleted";
  }

  findFederatedPasswordAccountId(args: {
    userId: string;
  }): Promise<string | null> {
    return this.deps.legacy.findFederatedPasswordAccountId(args);
  }

  findSecureAccountFacts(args: {
    userId: string;
  }): Promise<SecureAccountFacts> {
    return this.deps.legacy.findSecureAccountFacts(args);
  }

  createCredentialUser(args: {
    name: string;
    email: string;
    passwordHash: string;
  }): Promise<CreatedCredentialUser> {
    return this.deps.legacy.createCredentialUser(args);
  }

  createPasskeyUser(args: {
    email: string;
  }): Promise<{ id: string; created: boolean }> {
    return this.deps.legacy.createPasskeyUser(args);
  }
}
