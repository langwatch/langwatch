import { type IdentifierFact, isLiveIdentifierState } from "@langwatch/identity";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
  IdentityResolution,
  IdentityResolutionPort,
} from "../../better-auth/storage-ports";
import type { InMemoryHeads } from "./in-memory-heads";

interface StoredCredential {
  id: string;
  userId: string;
  providerId: string;
  secrets: IdentityAccountSecrets;
  createdAt: Date;
  updatedAt: Date;
}

const EMPTY_SECRETS = {
  password: null,
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scope: null,
} satisfies Required<IdentityAccountSecrets>;

/**
 * The identity branch's storage, in memory: `Identifier` heads joined to a
 * credential map, and the `(value | subject) ⋈ migration state` resolution
 * read beside them.
 *
 * The heads are the SAME projection the guards read, so a suite that drives
 * real better-auth through the adapter watches one fold feed both. The
 * `Account` rows are the memory adapter's own, which is what makes the
 * bridge mirror observable.
 */
export class InMemoryIdentityStorage
  implements IdentityAccountsPort, IdentityResolutionPort
{
  readonly credentials = new Map<string, StoredCredential>();

  constructor(
    private readonly heads: InMemoryHeads,
    private readonly isFinalized: (userId: string) => boolean,
    private readonly accountRows: Record<string, unknown>[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findByUser({
    userId,
  }: {
    userId: string;
  }): Promise<IdentityAccountRow[]> {
    return this.linkedIdentifiers()
      .filter((identifier) => identifier.userId === userId)
      .map((identifier) => this.assemble(identifier));
  }

  async findByAccountIds({
    accountIds,
  }: {
    accountIds: readonly string[];
  }): Promise<IdentityAccountRow[]> {
    return this.linkedIdentifiers()
      .filter((identifier) => accountIds.includes(identifier.accountId ?? ""))
      .map((identifier) => this.assemble(identifier));
  }

  async findByProviderSubject({
    userId,
    providerId,
    providerAccountId,
  }: {
    userId: string;
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityAccountRow | null> {
    const identifier = this.linkedIdentifiers().find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.providerId === providerId &&
        candidate.providerAccountId === providerAccountId,
    );
    return identifier === undefined ? null : this.assemble(identifier);
  }

  async createCredential({
    accountId,
    userId,
    providerId,
    secrets,
  }: {
    accountId: string;
    userId: string;
    providerId: string;
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    if (this.credentials.has(accountId)) return;
    const stamp = this.now();
    this.credentials.set(accountId, {
      id: accountId,
      userId,
      providerId,
      secrets: { ...EMPTY_SECRETS, ...secrets },
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  async updateCredentials({
    accountIds,
    secrets,
  }: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    for (const accountId of accountIds) {
      const credential = this.credentials.get(accountId);
      if (!credential) continue;
      this.credentials.set(accountId, {
        ...credential,
        secrets: { ...credential.secrets, ...secrets },
        updatedAt: this.now(),
      });
    }
  }

  async deleteCredentials({
    accountIds,
  }: {
    accountIds: readonly string[];
  }): Promise<number> {
    let deleted = 0;
    for (const accountId of accountIds) {
      if (this.credentials.delete(accountId)) deleted += 1;
    }
    return deleted;
  }

  async deleteBridgeAccounts({
    accountIds,
  }: {
    accountIds: readonly string[];
  }): Promise<number> {
    let deleted = 0;
    for (let index = this.accountRows.length - 1; index >= 0; index -= 1) {
      const row = this.accountRows[index];
      if (typeof row?.id === "string" && accountIds.includes(row.id)) {
        this.accountRows.splice(index, 1);
        deleted += 1;
      }
    }
    return deleted;
  }

  async mirrorSecretsOntoAccounts({
    accountIds,
    secrets,
  }: {
    accountIds: readonly string[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> {
    for (const row of this.accountRows) {
      if (typeof row.id === "string" && accountIds.includes(row.id)) {
        Object.assign(row, secrets);
      }
    }
  }

  async resolveByIdentifierValue({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<IdentityResolution | null> {
    return this.resolve(
      (identifier) =>
        identifier.value === normalizedValue &&
        (identifier.state === "VERIFIED" || identifier.state === "PRIMARY"),
    );
  }

  async resolveByProviderSubject({
    providerId,
    providerAccountId,
  }: {
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityResolution | null> {
    return this.resolve(
      (identifier) =>
        identifier.providerId === providerId &&
        identifier.providerAccountId === providerAccountId &&
        isLiveIdentifierState(identifier.state),
    );
  }

  private resolve(
    matches: (identifier: IdentifierFact) => boolean,
  ): IdentityResolution | null {
    for (const heads of this.heads.heads.values()) {
      for (const identifier of Object.values(heads.identifiers)) {
        if (!matches(identifier)) continue;
        return {
          userId: identifier.userId,
          finalized: this.isFinalized(identifier.userId),
        };
      }
    }
    return null;
  }

  private linkedIdentifiers(): IdentifierFact[] {
    return [...this.heads.heads.values()]
      .flatMap((heads) => Object.values(heads.identifiers))
      .filter(
        (identifier) =>
          typeof identifier.accountId === "string" &&
          isLiveIdentifierState(identifier.state),
      );
  }

  private assemble(identifier: IdentifierFact): IdentityAccountRow {
    const accountId = identifier.accountId ?? "";
    const credential = this.credentials.get(accountId);
    const secrets = { ...EMPTY_SECRETS, ...credential?.secrets };
    return {
      id: accountId,
      userId: identifier.userId,
      // better-auth's own provider id when the credential row carries it;
      // the identifier's vocabulary is lossy for generic OAuth.
      providerId:
        credential?.providerId ?? identifier.providerId ?? identifier.provider,
      accountId: identifier.providerAccountId ?? identifier.value ?? "",
      ...secrets,
      createdAt: credential?.createdAt ?? new Date(identifier.attachedAtMs),
      updatedAt: credential?.updatedAt ?? new Date(identifier.attachedAtMs),
    };
  }
}

const refuses = (method: string) => () => {
  throw new Error(
    `the identity branch wrote through ${method} with the gate closed`,
  );
};

/**
 * Ports that hold nothing: what the adapter runs on when no user is latched.
 *
 * The READS answer empty rather than throwing, because a read by account id
 * has no user to gate on until it has read — that probe is how the branch
 * learns whose row it is, and it finding nothing is exactly how an unlatched
 * user reaches the legacy table. Every WRITE throws, which is the claim that
 * matters: a closed gate must not put a single row or fact into identity
 * storage.
 */
export const inertIdentityPorts = {
  accounts: {
    async findByUser() {
      return [];
    },
    async findByAccountIds() {
      return [];
    },
    async findByProviderSubject() {
      return null;
    },
    createCredential: refuses("createCredential"),
    updateCredentials: refuses("updateCredentials"),
    deleteCredentials: refuses("deleteCredentials"),
    deleteBridgeAccounts: refuses("deleteBridgeAccounts"),
    mirrorSecretsOntoAccounts: refuses("mirrorSecretsOntoAccounts"),
  } satisfies IdentityAccountsPort,
  resolution: {
    async resolveByIdentifierValue() {
      return null;
    },
    async resolveByProviderSubject() {
      return null;
    },
  } satisfies IdentityResolutionPort,
};
