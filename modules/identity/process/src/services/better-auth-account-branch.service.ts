import { HandledError } from "@langwatch/handled-error";
import {
  IDENTITY_UNSUPPORTED_STORAGE_QUERY_CODE,
  IdentityUnsupportedStorageQueryError,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { DBAdapter } from "better-auth/adapters";

import {
  type AccountQuery,
  type AccountWhere,
  parseAccountQuery,
} from "../rules/better-auth-account-queries.rules.ts";
import {
  foreignUpdateFields,
  readIdentified,
  secretsOf,
  type StorageRow as Row,
  withIssuer,
} from "../rules/better-auth-storage-rows.rules.ts";
import type { IdentityAccountCeremonies } from "../rules/ceremony-types.rules.ts";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccounts,
  IdentityResolver,
} from "../rules/identity-storage.rules.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

const logger = createLogger("langwatch:identity:storage-adapter");

export interface AccountBranchDeps {
  /** better-auth's stock engine, bound to this instance's options. */
  legacy: DBAdapter;
  accounts: IdentityAccounts;
  resolution: IdentityResolver;
  ceremonies: IdentityAccountCeremonies;
  isUserOnIdentityWrites: IdentityUserGate;
  isAnyoneOnIdentityWrites: () => Promise<boolean>;
}

/** The `account` model on the identity branch: the gate, the projection reads, secrets and
 *  detach. */
export class BetterAuthAccountBranchService {
  static create(deps: AccountBranchDeps): BetterAuthAccountBranchService {
    return new BetterAuthAccountBranchService(deps);
  }

  private constructor(private readonly deps: AccountBranchDeps) {}

  /**
   * A refusal, logged on its way out. better-auth catches an adapter throw and turns it into a
   * redirect carrying the error CODE and nothing else, so an unlogged refusal reaches the
   * customer as a sign-in error page and leaves NOTHING behind to diagnose it with.
   */
  static refused<T>(error: T): T {
    // Recognised by CODE, not by class: the class is published from the contract
    // package, and a bundler that loads two copies of it makes `instanceof` lie.
    if (HandledError.isHandled(error) && error.code === IDENTITY_UNSUPPORTED_STORAGE_QUERY_CODE) {
      logger.error(
        { err: error, detail: error.reasons[0]?.message },
        "the identity storage adapter refused a better-auth account operation; the sign-in or account write it belongs to fails",
      );
    }
    return error;
  }

  /** The user a query names outright, when it names one. */
  private readonly namedUserId = (where: readonly AccountWhere[]): string | null => {
    const clause = where.find(
      (candidate) =>
        candidate.field === "userId" &&
        (candidate.operator === undefined || candidate.operator === "eq") &&
        (candidate.connector === undefined || candidate.connector.toUpperCase() === "AND"),
    );
    return typeof clause?.value === "string" ? clause.value : null;
  };

  /** The write fork, as every routed write asks it (ADR-116 §2). */
  private readonly routesToIdentity: IdentityUserGate = (input) =>
    this.deps.isUserOnIdentityWrites(input);

  /** The same fork asked of the fleet, for a query that names nobody. */
  private readonly anyoneRoutesToIdentity = (): Promise<boolean> =>
    this.deps.isAnyoneOnIdentityWrites();

  /**
   * A better-auth `account` update is a token refresh or a password change — secrets, and
   * nothing else. A payload that names a linkage column is asking the branch to rewrite what
   * only a command may state, so it refuses rather than dropping the field silently.
   */
  readonly secretsOfUpdate = (
    operation: string,
    update: Row,
    rows: readonly IdentityAccountRow[],
  ): IdentityAccountSecrets => {
    const foreign = foreignUpdateFields({ update, rows });
    if (foreign.length > 0) {
      throw BetterAuthAccountBranchService.refused(
        new IdentityUnsupportedStorageQueryError(
          `identity storage adapter: better-auth issued an account ${operation} that writes linkage columns (${foreign.toSorted().join(", ")}). ` +
            "Linkage is event-truth on the identity branch, so it can only be stated as a command, never written as a column.",
        ),
      );
    }
    return secretsOf(update);
  };

  private readonly linkedAccount = async (key: {
    userId: string;
    providerId: string;
    providerAccountId: string;
  }): Promise<IdentityAccountRow[] | null> => {
    const read = await readIdentified(this.deps.accounts.getAccountByProviderSubject(key));
    return read.kind === "found" ? [read.value] : null;
  };

  private readonly servedByAccountIds = async (
    ids: readonly string[],
  ): Promise<IdentityAccountRow[] | null> => {
    const rows = await this.deps.accounts.findByAccountIds({ accountIds: [...ids] });
    if (rows.length === 0) return null;
    const served: IdentityAccountRow[] = [];
    for (const row of rows) {
      if (await this.routesToIdentity({ userId: row.userId })) served.push(row);
    }
    return served.length > 0 ? served : null;
  };

  private readonly serveAccounts = async (
    query: AccountQuery,
  ): Promise<IdentityAccountRow[] | null> => {
    switch (query.kind) {
      case "byUser":
        return this.deps.accounts.findByUser({ userId: query.userId });
      case "byUserAndProvider": {
        const rows = await this.deps.accounts.findByUser({ userId: query.userId });
        return rows.filter((row) => row.providerId === query.providerId);
      }
      case "byUserProviderSubject": {
        // The user is named, so the gate is decidable without resolving the
        // subject first — and the row is read under that user, which is
        // what keeps a subject collision between two IdPs from answering
        // with the wrong person's account.
        if (!(await this.routesToIdentity({ userId: query.userId }))) return null;
        return this.linkedAccount({
          userId: query.userId,
          providerId: query.providerId,
          providerAccountId: query.accountId,
        });
      }
      case "byId":
      case "byIds": {
        // A row id names no user, so the projection read comes FIRST and is
        // what tells us whose account it is; the gate then decides. That
        // costs an indexed lookup on a user the gate would have closed
        // anyway, and there is no cheaper order — the id is the only handle
        // the caller gave us.
        return this.servedByAccountIds(query.kind === "byId" ? [query.id] : query.ids);
      }
      case "byProviderSubject": {
        // The IdP callback's resolution read: no user is named, so the identity tables are
        // consulted FIRST and answer only when the
        // resolved user is finalized (ADR-116 §2). A miss, or a held
        const resolved = await readIdentified(
          this.deps.resolution.getResolutionByProviderSubject({
            providerId: query.providerId,
            providerAccountId: query.accountId,
          }),
        );
        if (resolved.kind === "missing" || !resolved.value.finalized) return null;
        return this.linkedAccount({
          userId: resolved.value.userId,
          providerId: query.providerId,
          providerAccountId: query.accountId,
        });
      }
      case "byIssuerSubject": {
        // The provider id comes BACK from resolution, not derived here: a
        // subject is unique only within an issuer, so guessing the provider
        // would let one IdP's subject answer for another's user. A miss, or
        // an unfinalized user, falls through to the legacy row — the
        // callback key names no user, so every user rides the same answer.
        const resolved = await readIdentified(
          this.deps.resolution.getResolutionByIssuerSubject({
            issuer: query.issuer,
            providerAccountId: query.accountId,
          }),
        );
        if (resolved.kind === "missing" || !resolved.value.finalized) return null;
        return this.linkedAccount({
          userId: resolved.value.userId,
          providerId: resolved.value.providerId,
          providerAccountId: query.accountId,
        });
      }
    }
  };

  /** The identity branch's answer to an `account` query, or null when the legacy row serves it. */
  readonly routeAccount = async ({
    operation,
    where: canonical,
  }: {
    operation: string;
    where: AccountWhere[];
  }): Promise<IdentityAccountRow[] | null> => {
    const named = this.namedUserId(canonical);
    if (named !== null) {
      if (!(await this.routesToIdentity({ userId: named }))) return null;
    } else if (!(await this.anyoneRoutesToIdentity())) {
      // Nobody is on the identity branch, so no `account` query can be one
      // of its — including a shape §7 would otherwise refuse. This is what
      // makes deploying the adapter change nothing for a fleet where no
      // operator has enrolled anyone.
      return null;
    }
    let query: AccountQuery;
    try {
      query = parseAccountQuery({ operation, where: canonical });
    } catch (error) {
      throw BetterAuthAccountBranchService.refused(error);
    }
    const served = await this.serveAccounts(query);
    return served === null ? null : served.map(withIssuer);
  };

  readonly applySecrets = async ({
    rows,
    secrets,
  }: {
    rows: readonly IdentityAccountRow[];
    secrets: IdentityAccountSecrets;
  }): Promise<void> => {
    if (Object.keys(secrets).length === 0) return;
    const accountIds = rows.map((row) => row.id);
    await this.deps.accounts.updateCredentials({ accountIds, secrets });
    await this.deps.accounts.mirrorSecretsOntoAccounts({ accountIds, secrets });
  };

  /**
   * An account create on the identity branch: the linkage is a fact, the
   * secrets are a row (ADR-116 §6).
   */
  readonly createOnIdentityBranch = async (canonical: Row): Promise<IdentityAccountRow | null> => {
    const { userId, providerId } = canonical;
    if (typeof userId !== "string" || typeof providerId !== "string") {
      return null;
    }
    const pin = await this.deps.ceremonies.createAccountIdentifier({
      id: canonical.id,
      userId,
      providerId,
      // The issuer better-auth resolved for this write, passed through so
      // the fact states the account key the library itself decided. Drop
      // it and the ceremony falls back to deriving one, which is wrong for
      // every provider that brings a real issuer of its own.
      issuer: canonical.issuer,
      accountId: canonical.accountId,
      createdAt: canonical.createdAt,
    });
    if (!pin.pinned) return null;
    const accountId = pin.data.id;

    const secrets = secretsOf(canonical);
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
    if (!written) {
      logger.warn(
        { userId, providerId, accountId },
        "the attached identifier is not in the projection yet; the account row falls back to the this.deps.legacy write",
      );
      return null;
    }
    return written;
  };

  /**
   * Unlink, and the fan-out a user delete performs (ADR-116 §8): a detach
   */
  readonly detachOnIdentityBranch = async (
    rows: readonly IdentityAccountRow[],
    { erasingUser = false }: { erasingUser?: boolean } = {},
  ): Promise<number> => {
    // An erase states itself, whole, through `beforeUserDelete`. Detaching
    // each row on the way would state the same removal twice and would ask
    // a guard about stranding a user who is being erased.
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
  };
}
