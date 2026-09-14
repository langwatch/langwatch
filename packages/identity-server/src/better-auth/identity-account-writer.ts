import type {
  CeremonyAccountRow,
  IdentityAccountCeremonies,
} from "./ceremony-types";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
} from "./storage-ports";

export interface IdentityAccountWriterDeps {
  accounts: IdentityAccountsPort;
  ceremonies: IdentityAccountCeremonies;
}

/**
 * The identity branch's canonical account mutation boundary.
 *
 * Linkage is stated through the ceremonies, secrets live in
 * `AccountCredential`, and the temporary `Account` bridge is synchronised
 * before a mutation returns. Both better-auth's storage adapter and the
 * account-settings service use this class so neither can leave one branch
 * accepting a credential the other has changed or removed.
 */
export class IdentityAccountWriter {
  private constructor(private readonly deps: IdentityAccountWriterDeps) {}

  static create(deps: IdentityAccountWriterDeps): IdentityAccountWriter {
    return new IdentityAccountWriter(deps);
  }

  async applySecrets({
    rows,
    secrets,
  }: {
    rows: readonly IdentityAccountRow[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    if (Object.keys(secrets).length === 0) return;

    const accountIds = rows.map((row) => row.id);
    await this.deps.accounts.updateCredentials({ accountIds, secrets });
    await this.deps.accounts.mirrorSecretsOntoAccounts({
      accountIds,
      secrets,
    });
  }

  async tryCreateCredential({
    account,
    userId,
    providerId,
    secrets,
  }: {
    account: CeremonyAccountRow;
    userId: string;
    providerId: string;
    secrets: IdentityAccountSecrets;
  }): Promise<IdentityAccountRow | null> {
    const pinned = await this.deps.ceremonies.beforeAccountCreate(account);
    const accountId = pinned?.data.id;
    if (accountId === undefined) return null;

    await this.deps.accounts.createCredential({
      accountId,
      userId,
      providerId,
      secrets,
    });
    await this.deps.accounts.mirrorSecretsOntoAccounts({
      accountIds: [accountId],
      secrets,
    });

    const [written] = await this.deps.accounts.findByAccountIds({
      accountIds: [accountId],
    });
    return written ?? null;
  }

  async detach({
    rows,
    erasingUser = false,
  }: {
    rows: readonly IdentityAccountRow[];
    erasingUser?: boolean;
  }): Promise<number> {
    if (!erasingUser) {
      for (const row of rows) {
        await this.deps.ceremonies.beforeAccountDelete({
          id: row.id,
          userId: row.userId,
          providerId: row.providerId,
        });
      }
    }

    const accountIds = rows.map((row) => row.id);
    await this.deps.accounts.deleteCredentials({ accountIds });
    await this.deps.accounts.deleteBridgeAccounts({ accountIds });
    return rows.length;
  }
}
