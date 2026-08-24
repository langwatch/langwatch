import {
  type IdentifierFact,
  identifierProviderFor,
} from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type {
  AccountCredentialPatch,
  AccountCredentialsRepository,
} from "../account-credentials.repository";
import type { IdentityHeadsRepository } from "../identity-heads.repository";
import type { IdentityUserGate } from "../identity-user-gate";
import {
  type AccountQuery,
  type AccountWhere,
  parseAccountQuery,
} from "./account-queries";
import {
  type BetterAuthAccountRow,
  toBetterAuthAccount,
  toCredentialPatch,
} from "./account-projection";

const logger = createLogger("langwatch:identity:account-store");

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * The `account` model as identity serves it (ADR-116 §3): reads assembled
 * from `Identifier` ⋈ `AccountCredential`, writes that touch only secrets.
 *
 * This is the READ and CREDENTIAL half of the adapter. The linkage half —
 * an account appearing or disappearing — is a ceremony, and lives with the
 * other ceremonies rather than here, because attaching an identifier is a
 * domain event whatever caused it.
 *
 * Every method answers `null` / `[]` when the projection knows nothing,
 * which during migration is how an unmigrated user reaches the legacy
 * `Account` table: the adapter tries here first and falls through. Once no
 * user is unmigrated the fallback goes and this is the only answer.
 */
export class IdentityAccountStore {
  constructor(
    private readonly heads: IdentityHeadsRepository,
    private readonly credentials: AccountCredentialsRepository,
    private readonly isOnIdentity: IdentityUserGate,
  ) {}

  /** One account, or null when the projection does not hold it. */
  async findOne({
    where,
  }: {
    where: AccountWhere[];
  }): Promise<BetterAuthAccountRow | null> {
    const query = parseAccountQuery({ operation: "findOne", where });
    const rows = await this.resolve(query);
    return rows[0] ?? null;
  }

  /** Every account the projection holds for this query. */
  async findMany({
    where,
  }: {
    where: AccountWhere[];
  }): Promise<BetterAuthAccountRow[]> {
    return this.resolve(parseAccountQuery({ operation: "findMany", where }));
  }

  /**
   * A token refresh or a password change: secrets only, never an event. The
   * rows are located through the projection, so a write can only ever land
   * on an account identity knows about.
   */
  async update({
    where,
    update,
  }: {
    where: AccountWhere[];
    update: Record<string, unknown>;
  }): Promise<BetterAuthAccountRow[]> {
    const query = parseAccountQuery({ operation: "update", where });
    const rows = await this.resolve(query);
    if (rows.length === 0) return [];
    const patch = toCredentialPatch(update) as AccountCredentialPatch;
    if (Object.keys(patch).length === 0) return rows;
    await this.credentials.updateMany({
      ids: rows.map((row) => row.id),
      patch,
    });
    // Re-read rather than merge in memory: the caller uses what comes back,
    // and a merged guess would drift from what the row actually holds.
    return this.resolve(query);
  }

  /** The credential rows behind these accounts, removed. */
  async deleteCredentials({ ids }: { ids: string[] }): Promise<number> {
    return this.credentials.deleteByIds({ ids });
  }

  /**
   * Store the secrets for an account whose identifier the ceremony has
   * already attached, and answer the row better-auth expects back.
   *
   * The ordering this depends on is the hook's: `account.create.before` ran
   * the attach, and the ledger waited for the fold, so by the time
   * better-auth reaches the adapter the identifier is in the projection and
   * can be found by the row id the ceremony pinned. If it cannot be found —
   * the fold lagged past its window — this answers null and the caller falls
   * back to the legacy write, which is the safe direction: a row better-auth
   * can read beats a sign-up that fails.
   */
  async createCredentialFor({
    row,
  }: {
    row: Record<string, unknown>;
  }): Promise<BetterAuthAccountRow | null> {
    const { id, userId, providerId } = row;
    if (
      typeof id !== "string" ||
      typeof userId !== "string" ||
      typeof providerId !== "string"
    ) {
      return null;
    }
    const identifierId = await this.heads.findIdentifierIdForAccount({
      userId,
      accountId: id,
      provider: identifierProviderFor(providerId),
    });
    if (identifierId === null) {
      logger.warn(
        { userId, accountId: id, providerId },
        "no identifier mirrors the account being created; falling back to the legacy row write",
      );
      return null;
    }
    const identifier = await this.heads.findIdentifierById({ identifierId });
    if (!identifier) return null;
    await this.credentials.create({
      id,
      identifierId,
      type: typeof row.type === "string" ? row.type : "oauth",
      accessToken: stringOrNull(row.accessToken),
      refreshToken: stringOrNull(row.refreshToken),
      idToken: stringOrNull(row.idToken),
      password: stringOrNull(row.password),
      scope: stringOrNull(row.scope),
      tokenType: stringOrNull(row.tokenType),
      sessionState: stringOrNull(row.sessionState),
      expiresAtMs:
        row.expiresAt instanceof Date ? row.expiresAt.getTime() : null,
      extExpiresIn:
        typeof row.extExpiresIn === "number" ? row.extExpiresIn : null,
    });
    const credential = await this.credentials.findById({ id });
    return toBetterAuthAccount({ identifier, credential });
  }

  /** Whether identity answers for this user at all. */
  async serves({ userId }: { userId: string }): Promise<boolean> {
    return this.isOnIdentity({ userId });
  }

  private async resolve(
    query: AccountQuery,
  ): Promise<BetterAuthAccountRow[]> {
    switch (query.kind) {
      case "byProviderAccount":
        return this.byProviderAccount(query);
      case "byId":
        return this.byIds({ ids: [query.id] });
      case "byIds":
        return this.byIds({ ids: query.ids });
      case "byUser":
        return this.byUser({ userId: query.userId });
      case "byUserAndProvider": {
        const rows = await this.byUser({ userId: query.userId });
        return rows.filter((row) => row.providerId === query.provider);
      }
    }
  }

  /**
   * The IdP callback's lookup — cross-user by necessity, because the whole
   * question is which user this subject belongs to. The gate is checked
   * AFTER the match rather than before: there is no user to ask about until
   * one is found, and a match means that user has identifiers, which only a
   * backfilled user has.
   */
  private async byProviderAccount({
    provider,
    providerAccountId,
  }: {
    provider: string;
    providerAccountId: string;
  }): Promise<BetterAuthAccountRow[]> {
    const identifier = await this.heads.findLiveIdentifierByProviderAccount({
      provider: identifierProviderFor(provider),
      providerAccountId,
    });
    if (!identifier) return [];
    if (!(await this.isOnIdentity({ userId: identifier.userId }))) {
      // The projection holds a row for a user the gate has since closed —
      // an operator rollback mid-flight. The legacy table is their truth
      // again, so answer nothing and let the caller fall through.
      logger.info(
        { userId: identifier.userId, provider },
        "identifier matched a user the write gate has closed; deferring to the legacy account row",
      );
      return [];
    }
    return this.withCredentials([identifier]);
  }

  private async byUser({
    userId,
  }: {
    userId: string;
  }): Promise<BetterAuthAccountRow[]> {
    if (!(await this.isOnIdentity({ userId }))) return [];
    return this.withCredentials(await this.heads.findLiveIdentifiers({ userId }));
  }

  /**
   * By row id, which is the credential's id. The identifier is reached back
   * through it, and the gate then decides — the same fork every other path
   * takes, just arrived at from the other end.
   */
  private async byIds({
    ids,
  }: {
    ids: string[];
  }): Promise<BetterAuthAccountRow[]> {
    const rows: BetterAuthAccountRow[] = [];
    for (const id of ids) {
      const credential = await this.credentials.findById({ id });
      if (!credential) continue;
      // The credential names an identifier and nothing else, so this read
      // is what tells us whose account it is - the gate can only be asked
      // afterwards.
      const identifier = await this.heads.findIdentifierById({
        identifierId: credential.identifierId,
      });
      if (!identifier) continue;
      if (!(await this.isOnIdentity({ userId: identifier.userId }))) continue;
      rows.push(toBetterAuthAccount({ identifier, credential }));
    }
    return rows;
  }

  private async withCredentials(
    identifiers: readonly IdentifierFact[],
  ): Promise<BetterAuthAccountRow[]> {
    if (identifiers.length === 0) return [];
    const credentials = await this.credentials.findByIdentifierIds({
      identifierIds: identifiers.map((identifier) => identifier.identifierId),
    });
    const byIdentifier = new Map(
      credentials.map((credential) => [credential.identifierId, credential]),
    );
    return identifiers.map((identifier) =>
      toBetterAuthAccount({
        identifier,
        credential: byIdentifier.get(identifier.identifierId) ?? null,
      }),
    );
  }
}
