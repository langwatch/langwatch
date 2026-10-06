import { HandledError } from "@langwatch/handled-error";
import {
  normalizeIdentifierValue,
  IDENTITY_UNSUPPORTED_STORAGE_QUERY_CODE,
  IdentityUnsupportedStorageQueryError,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { fromDate, toDate } from "@langwatch/time";
import type { BetterAuthOptions } from "better-auth";
import type {
  AdapterFactory,
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CleanedWhere,
  CustomAdapter,
  DBAdapter,
} from "better-auth/adapters";
import { createAdapterFactory } from "better-auth/adapters";
import { APIError } from "better-auth/api";

import {
  type AccountQuery,
  type AccountWhere,
  issuerForProviderId,
  parseAccountQuery,
  providerIdFromIssuer,
} from "../rules/better-auth-account-queries.rules.ts";
import type { IdentityAccountCeremonies } from "../rules/ceremony-types.rules.ts";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccounts,
  IdentityResolver,
} from "../rules/identity-storage.rules.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

const logger = createLogger("langwatch:identity:storage-adapter");

/** A resolution or account miss: the normal "not on the identity branch" answer. */
const IDENTIFIER_NOT_FOUND = "identity_identifier_not_found";

/**
 * A refusal, logged on its way out. better-auth catches an adapter throw and turns it into a
 * redirect carrying the error CODE and nothing else, so an unlogged refusal reaches the
 * customer as a sign-in error page and leaves NOTHING behind to diagnose it with.
 */
const refused = <T>(error: T): T => {
  // Recognised by CODE, not by class: the class is published from the contract
  // package, and a bundler that loads two copies of it makes `instanceof` lie.
  if (HandledError.isHandled(error) && error.code === IDENTITY_UNSUPPORTED_STORAGE_QUERY_CODE) {
    logger.error(
      { err: error, detail: error.reasons[0]?.message },
      "the identity storage adapter refused a better-auth account operation; the sign-in or account write it belongs to fails",
    );
  }
  return error;
};

/** The secret set the identity branch owns. Everything else on the `account`
 *  model is linkage, and linkage is a command rather than a column write. */
const SECRET_FIELDS = [
  "password",
  "accessToken",
  "refreshToken",
  "idToken",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "scope",
] as const;

/** Written by the store itself, so an update naming it is not a linkage
 *  rewrite and does not have to refuse. */
const UPDATE_PASSTHROUGH_FIELDS = ["createdAt", "updatedAt"] as const;

/**
 * Linkage columns better-auth RESTATES on an update it means as a secret write — accepted when
 * the value it carries already matches the row, and refused when it differs. A restatement is
 * not a rewrite.
 */
const LINKAGE_RESTATEMENT_FIELDS = ["providerId", "issuer", "accountId", "userId"] as const;

type LinkageRestatementField = (typeof LINKAGE_RESTATEMENT_FIELDS)[number];

const isLinkageRestatementField = (field: string): field is LinkageRestatementField =>
  LINKAGE_RESTATEMENT_FIELDS.some((known) => known === field);

/**
 * The value a row states for a linkage field, with `issuer` resolved the same way the served
 * row resolves it — a row attached before the fact carried an issuer answers with the synthetic
 * form better-auth minted, and that is the value better-auth is echoing back.
 */
const linkageValueOf = (row: IdentityAccountRow, field: LinkageRestatementField): string =>
  field === "issuer" ? (row.issuer ?? issuerForProviderId(row.providerId)) : row[field];

export interface IdentityStorageAdapterDeps {
  /**
   * better-auth's own published storage engine, built (`prismaAdapter(...)`,
   * `memoryAdapter(...)`) but not yet bound to options. The legacy branch delegates to it
   * verbatim, so an unlatched user's behavior is byte-for-byte what the stock adapter did.
   */
  legacyEngine: (options: BetterAuthOptions) => DBAdapter;
  accounts: IdentityAccounts;
  resolution: IdentityResolver;
  ceremonies: IdentityAccountCeremonies;
  /** ADR-116 §2: `finalized` and nothing else, cached, fail-closed. */
  isUserOnIdentityWrites: IdentityUserGate;
  /**
   * Whether ANY user has finalized, fleet-wide — the same pre-rollout short-circuit the write
   * gate already reads.
   */
  isAnyoneOnIdentityWrites: () => Promise<boolean>;
  passkeyRemoval: PasskeyRemoval;
}

type PasskeyRemovalOutcome = "deleted" | "not_found" | "would_strand_user";

/**
 * The atomic persistence boundary behind better-auth's one-passkey delete.
 * Decision and deletion share one serializable transaction: two removals
 * reading the same stale set could both proceed and lock the user out.
 */
export interface PasskeyRemoval {
  deleteIfAnotherWayInRemains(args: { passkeyId: string }): Promise<PasskeyRemovalOutcome>;
}

/**
 * better-auth's one `database:` entry (ADR-116 §1): an identity-owned
 */
export class BetterAuthIdentityStorageService {
  static create(deps: IdentityStorageAdapterDeps): BetterAuthIdentityStorageService {
    return new BetterAuthIdentityStorageService(deps);
  }

  private constructor(private readonly deps: IdentityStorageAdapterDeps) {}

  /** The better-auth adapter factory this branch installs. */
  factory(): AdapterFactory<BetterAuthOptions> {
    return (options) =>
      createAdapterFactory({
        config: identityAdapterConfig,
        adapter: identityCustomAdapter({
          ...this.deps,
          legacy: this.deps.legacyEngine(options),
        }),
      })(options);
  }
}

/**
 * Value coercion is deliberately absent: every `supports*` flag is on, so this factory maps
 * NAMES and leaves shapes alone.
 */
const identityAdapterConfig: AdapterFactoryConfig = {
  adapterId: "langwatch-identity",
  adapterName: "LangWatch Identity Adapter",
  supportsJSON: true,
  supportsDates: true,
  supportsBooleans: true,
  supportsArrays: true,
  supportsNumericIds: true,
  supportsUUIDs: true,
};

type Row = Record<string, unknown>;

type AdapterNaming = Parameters<AdapterFactoryCustomizeAdapterCreator>[0];

type IdentityStorageRoutingDeps = Omit<IdentityStorageAdapterDeps, "legacyEngine"> & {
  legacy: DBAdapter;
};

/** The adapter better-auth's factory customizes: every routed read and write, one method each. */
class IdentityStorageRouting {
  constructor(
    private readonly deps: IdentityStorageRoutingDeps,
    private readonly naming: AdapterNaming,
  ) {}

  adapter(): CustomAdapter {
    return {
      create: this.create,
      findOne: this.findOne,
      findMany: this.findMany,
      count: this.count,
      update: this.update,
      updateMany: this.updateMany,
      delete: this.delete,
      deleteMany: this.deleteMany,
      consumeOne: this.consumeOne,
      incrementOne: this.incrementOne,
    };
  }

  private readonly modelOf = (model: string): string => this.naming.getDefaultModelName(model);

  /** The write fork, as every routed write asks it (ADR-116 §2). */
  private readonly routesToIdentity: IdentityUserGate = (input) =>
    this.deps.isUserOnIdentityWrites(input);

  /** The same fork asked of the fleet, for a query that names nobody. */
  private readonly anyoneRoutesToIdentity = (): Promise<boolean> =>
    this.deps.isAnyoneOnIdentityWrites();

  private readonly toCanonicalKeys = (model: string, data: Row): Row =>
    Object.fromEntries(
      Object.entries(data).map(([field, value]) => [
        this.naming.getDefaultFieldName({ model, field }),
        value,
      ]),
    );

  private readonly toStorageKeys = (model: string, row: Row): Row =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [
        this.naming.getFieldName({ model, field }),
        value,
      ]),
    );

  private readonly canonicalWhere = (
    model: string,
    where: readonly CleanedWhere[] | undefined,
  ): AccountWhere[] =>
    (where ?? []).map((clause) => ({
      ...clause,
      field: this.naming.getDefaultFieldName({ model, field: clause.field }),
    }));

  /**
   * The user a query names outright, when it names one.
   */
  private readonly namedUserId = (where: readonly AccountWhere[]): string | null => {
    const clause = where.find(
      (candidate) =>
        candidate.field === "userId" &&
        (candidate.operator === undefined || candidate.operator === "eq") &&
        (candidate.connector === undefined || candidate.connector.toUpperCase() === "AND"),
    );
    return typeof clause?.value === "string" ? clause.value : null;
  };

  /**
   * Whether an `account` write is scoped to one user and NOTHING else — every row they hold,
   * named by no provider, subject or row id. That shape reaches `deleteMany` from exactly one
   * place: better-auth erasing the user.
   */
  private readonly isWholeUserScope = (
    model: string,
    where: readonly CleanedWhere[] | undefined,
  ): boolean => {
    const canonical = this.canonicalWhere(model, where);
    const clause = canonical[0];
    return (
      canonical.length === 1 &&
      clause !== undefined &&
      clause.field === "userId" &&
      (clause.operator === undefined || clause.operator.toLowerCase() === "eq") &&
      typeof clause.value === "string"
    );
  };

  /** The exact one-row shape emitted by the passkey plugin's delete route. */
  private readonly exactRecordId = (
    model: string,
    where: readonly CleanedWhere[] | undefined,
  ): string | null => {
    const canonical = this.canonicalWhere(model, where);
    if (canonical.length !== 1) {
      return null;
    }
    const clause = canonical[0];
    if (clause === undefined || clause.field !== "id") return null;
    if (clause.operator !== undefined && clause.operator.toLowerCase() !== "eq") return null;
    if (clause.connector !== undefined && clause.connector.toUpperCase() !== "AND") return null;
    return typeof clause.value === "string" ? clause.value : null;
  };

  /** The record a `user` query names outright — the same narrowing
   *  `namedUserId` applies, one field over, because on the `user` model the
   *  user IS the record. */
  private readonly namedRecordId = (where: readonly AccountWhere[]): string | null => {
    const clause = where.find(
      (candidate) =>
        candidate.field === "id" &&
        (candidate.operator === undefined || candidate.operator === "eq") &&
        (candidate.connector === undefined || candidate.connector.toUpperCase() === "AND"),
    );
    return typeof clause?.value === "string" ? clause.value : null;
  };

  private readonly secretsOf = (row: Row): IdentityAccountSecrets =>
    Object.fromEntries(
      SECRET_FIELDS.filter((field) => field in row).map((field) => [
        field,
        toSecretValue(row[field]),
      ]),
    );

  /**
   * A better-auth `account` update is a token refresh or a password change — secrets, and
   * nothing else. A payload that names a linkage column is asking the branch to rewrite what
   * only a command may state, so it refuses rather than dropping the field silently.
   */
  private readonly secretsOfUpdate = (
    operation: string,
    update: Row,
    rows: readonly IdentityAccountRow[],
  ): IdentityAccountSecrets => {
    /** A linkage field whose value every named row already states — an
     *  echo of what better-auth just read, which writes nothing. */
    const restatesItself = (field: string): boolean =>
      isLinkageRestatementField(field) &&
      rows.length > 0 &&
      rows.every((row) => linkageValueOf(row, field) === update[field]);

    const foreign = Object.keys(update).filter(
      (field) =>
        !SECRET_FIELDS.some((secret) => secret === field) &&
        !UPDATE_PASSTHROUGH_FIELDS.some((passed) => passed === field) &&
        !restatesItself(field),
    );
    if (foreign.length > 0) {
      throw refused(
        new IdentityUnsupportedStorageQueryError(
          `identity storage adapter: better-auth issued an account ${operation} that writes linkage columns (${foreign.toSorted().join(", ")}). ` +
            "Linkage is event-truth on the identity branch, so it can only be stated as a command, never written as a column.",
        ),
      );
    }
    return this.secretsOf(update);
  };

  /**
   * The row as better-auth 1.7 expects it, carrying the issuer half of its account key. The
   * identifier STORES the issuer — stated on the attach, exactly as better-auth decided it —
   * so the stored value is served verbatim.
   */
  private readonly withIssuer = (row: IdentityAccountRow): IdentityAccountRow => ({
    ...row,
    issuer: row.issuer ?? issuerForProviderId(row.providerId),
  });

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

  private readonly routeAccount = async ({
    model,
    operation,
    where,
  }: {
    model: string;
    operation: string;
    where: readonly CleanedWhere[] | undefined;
  }): Promise<IdentityAccountRow[] | null> => {
    const canonical = this.canonicalWhere(model, where);
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
      throw refused(error);
    }
    const served = await this.serveAccounts(query);
    return served === null ? null : served.map(this.withIssuer);
  };

  private readonly applySecrets = async ({
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
  private readonly createOnIdentityBranch = async (
    canonical: Row,
  ): Promise<IdentityAccountRow | null> => {
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

    const secrets = this.secretsOf(canonical);
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
   * The identifier-first half of `findUserByEmail` (ADR-116 §6): the
   */
  private readonly resolveUserWhere = async (
    model: string,
    where: readonly CleanedWhere[],
  ): Promise<CleanedWhere[]> => {
    const clause = where[0];
    if (where.length !== 1 || clause === undefined) return [...where];
    if (this.naming.getDefaultFieldName({ model, field: clause.field }) !== "email")
      return [...where];
    if (clause.operator !== "eq" || typeof clause.value !== "string") return [...where];
    const resolved = await readIdentified(
      this.deps.resolution.getResolutionByIdentifierValue({
        normalizedValue: normalizeIdentifierValue(clause.value),
      }),
    );
    if (resolved.kind === "missing" || !resolved.value.finalized) return [...where];
    return [
      {
        field: this.naming.getFieldName({ model, field: "id" }),
        value: resolved.value.userId,
        operator: "eq",
        connector: "AND",
        mode: "sensitive",
      },
    ];
  };

  /**
   * A `user` update on the identity branch, with `email` taken out of it
   * (ADR-116 §6) — or the update exactly as it arrived.
   */
  private readonly withoutRoutedEmail = async ({
    model,
    where,
    update,
  }: {
    model: string;
    where: readonly CleanedWhere[] | undefined;
    update: Row;
  }): Promise<Row> => {
    const canonical = this.toCanonicalKeys(model, update);
    const email = canonical.email;
    if (typeof email !== "string") return update;
    const named = this.namedRecordId(this.canonicalWhere(model, where));
    if (named === null || !(await this.routesToIdentity({ userId: named }))) {
      return update;
    }
    await this.deps.ceremonies.beforeEmailChange({ userId: named, email });
    return Object.fromEntries(
      Object.entries(update).filter(
        ([field]) => this.naming.getDefaultFieldName({ model, field }) !== "email",
      ),
    );
  };

  /**
   * Translates an `issuer` clause in an account `where` for the legacy engine:
   * matching providerId is dropped, a different one refuses, and a synthetic
   * issuer alone rewrites to providerId so a null-issuer row is still found.
   */
  private readonly legacyAccountWhere = async (
    model: string,
    where: readonly CleanedWhere[],
  ): Promise<CleanedWhere[] | null> => {
    const canonicalNameOf = (clause: CleanedWhere): string =>
      this.naming.getDefaultFieldName({ model, field: clause.field });
    const issuerClause = where.find((clause) => canonicalNameOf(clause) === "issuer");
    if (issuerClause === undefined) return [...where];
    const issuer = issuerClause.value;
    if ((issuerClause.operator?.toLowerCase() ?? "eq") !== "eq" || typeof issuer !== "string") {
      return null;
    }
    const rest = where.filter((clause) => clause !== issuerClause);
    const derived = providerIdFromIssuer(issuer);
    const providerClause = rest.find((clause) => canonicalNameOf(clause) === "providerId");
    if (providerClause !== undefined) {
      const providerId = providerClause.value;
      if (typeof providerId !== "string") return null;
      if (derived.minted && derived.providerId === providerId) return rest;
      // A real connection issuer beside a providerId that does not decode
      // to it is ordinary single sign-on, not a contradiction — see the
      // upstream note this mirrors. Refusing every such pair refused every
      // RETURNING connection sign-in.
      return null;
    }
    if (!derived.minted) return [...where];
    return [{ ...issuerClause, field: "providerId", value: derived.providerId }];
  };

  /**
   * Minted back onto every account row the LEGACY branch serves: 1.7 checks the
   * issuer on a row it is handed, and a null one fails, surfacing to a
   * RETURNING user as "Something went wrong signing you in".
   */
  private readonly withLegacyIssuer = async (model: string, row: Row): Promise<Row> => {
    if (this.modelOf(model) !== "account") return row;
    if (row.issuer != null) return row;
    const providerId = row.providerId;
    if (typeof providerId !== "string") return row;
    return {
      ...row,
      issuer: issuerForProviderId(providerId),
    };
  };

  create: CustomAdapter["create"] = async ({ model, data, select }) => {
    const canonical = this.toCanonicalKeys(model, data);
    if (this.modelOf(model) === "account") {
      const userId = canonical.userId;
      if (typeof userId === "string" && (await this.routesToIdentity({ userId }))) {
        const written = await this.createOnIdentityBranch(canonical);
        if (written) return this.toStorageKeys(model, toBetterAuthAccount(written)) as never;
      }
    }
    const row = await this.deps.legacy.create<Row, Row>({
      model,
      data: canonical as never,
      select,
      // Ids are generated by THIS factory's `transformInput`, so by the
      // time the data reaches here `data.id` is already the id the
      // caller will see. Without this the legacy engine's own factory
      // would drop it and mint a second one — and the account id a
      // ceremony pinned would stop being the row's.
      forceAllowId: true,
    });
    return this.toStorageKeys(model, await this.withLegacyIssuer(model, row)) as never;
  };

  findOne: CustomAdapter["findOne"] = async ({ model, where, select, join }) => {
    let legacyWhere = where;
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({
        model,
        operation: "findOne",
        where,
      });
      if (rows !== null) {
        const row = rows[0];
        return row ? (this.toStorageKeys(model, toBetterAuthAccount(row)) as never) : null;
      }
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return null;
      legacyWhere = translated;
    }
    const found = await this.deps.legacy.findOne<Row>({
      model,
      where:
        this.modelOf(model) === "user"
          ? await this.resolveUserWhere(model, legacyWhere)
          : legacyWhere,
      select,
      join,
    });
    return found === null
      ? null
      : (this.toStorageKeys(model, await this.withLegacyIssuer(model, found)) as never);
  };

  findMany: CustomAdapter["findMany"] = async ({
    model,
    where,
    limit,
    select,
    sortBy,
    offset,
    join,
  }) => {
    let legacyWhere = where;
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({
        model,
        operation: "findMany",
        where,
      });
      if (rows !== null) {
        // Refused only once the query is known to be the identity
        // branch's. The legacy engine has always served sorts and offsets,
        // and a fleet nobody has enrolled must keep getting that answer.
        refuseOrderedAccountRead({ sorted: sortBy !== undefined, offset });
        return rows
          .slice(0, limit)
          .map((row) => this.toStorageKeys(model, toBetterAuthAccount(row))) as never;
      }
      // A findMany with no `where` asks for every account row, and there
      // is nothing in "everything" to translate.
      if (where !== undefined) {
        const translated = await this.legacyAccountWhere(model, where);
        if (translated === null) return [] as never;
        legacyWhere = translated;
      }
    }
    const found = await this.deps.legacy.findMany<Row>({
      model,
      where:
        this.modelOf(model) === "user" && legacyWhere !== undefined
          ? await this.resolveUserWhere(model, legacyWhere)
          : legacyWhere,
      limit,
      select,
      sortBy,
      offset,
      join,
    });
    return (await Promise.all(
      found.map(async (row) => this.toStorageKeys(model, await this.withLegacyIssuer(model, row))),
    )) as never;
  };

  count: CustomAdapter["count"] = async ({ model, where }) => {
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({ model, operation: "count", where });
      if (rows !== null) return rows.length;
      // Counting every account row has no issuer clause to translate.
      if (where === undefined) return this.deps.legacy.count({ model });
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return 0;
      return this.deps.legacy.count({ model, where: translated });
    }
    return this.deps.legacy.count({ model, where });
  };

  private readonly updateServedAccount = async ({
    model,
    update,
    rows,
  }: {
    model: string;
    update: Row;
    rows: readonly IdentityAccountRow[];
  }): Promise<Row | null> => {
    const first = rows[0];
    if (first === undefined) return null;
    await this.applySecrets({
      rows: [first],
      secrets: this.secretsOfUpdate("update", this.toCanonicalKeys(model, update), [first]),
    });
    const [fresh] = await this.deps.accounts.findByAccountIds({ accountIds: [first.id] });
    return fresh === undefined ? null : this.toStorageKeys(model, toBetterAuthAccount(fresh));
  };

  private readonly updateUserRow = async ({
    model,
    where,
    update,
  }: {
    model: string;
    where: CleanedWhere[];
    update: Row;
  }): Promise<Row | null> => {
    const remaining = await this.withoutRoutedEmail({ model, where, update });
    // An update that was ONLY the email has nothing left to write —
    // the command is the whole change — so the row is READ back rather
    // than written with an empty patch.
    if (Object.keys(remaining).length === 0) {
      const found = await this.deps.legacy.findOne<Row>({ model, where });
      return found === null ? null : this.toStorageKeys(model, found);
    }
    const updated = await this.deps.legacy.update<Row>({
      model,
      where,
      update: this.toCanonicalKeys(model, remaining),
    });
    return updated === null ? null : this.toStorageKeys(model, updated);
  };

  update: CustomAdapter["update"] = async ({ model, where, update }) => {
    let legacyWhere = where;
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({
        model,
        operation: "update",
        where,
      });
      if (rows !== null) {
        return (await this.updateServedAccount({ model, update: update as Row, rows })) as never;
      }
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return null;
      legacyWhere = translated;
    }
    if (this.modelOf(model) === "user") {
      return (await this.updateUserRow({ model, where, update: update as Row })) as never;
    }
    const row = await this.deps.legacy.update<Row>({
      model,
      where: legacyWhere,
      update: this.toCanonicalKeys(model, update as Row),
    });
    return row === null
      ? null
      : (this.toStorageKeys(model, await this.withLegacyIssuer(model, row)) as never);
  };

  updateMany: CustomAdapter["updateMany"] = async ({ model, where, update }) => {
    let legacyWhere = where;
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({
        model,
        operation: "updateMany",
        where,
      });
      if (rows !== null) {
        await this.applySecrets({
          rows,
          secrets: this.secretsOfUpdate("updateMany", this.toCanonicalKeys(model, update), rows),
        });
        return rows.length;
      }
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return 0;
      legacyWhere = translated;
    }
    if (this.modelOf(model) === "user") {
      const remaining = await this.withoutRoutedEmail({ model, where, update });
      if (Object.keys(remaining).length === 0) return 1;
      return this.deps.legacy.updateMany({
        model,
        where,
        update: this.toCanonicalKeys(model, remaining),
      });
    }
    return this.deps.legacy.updateMany({
      model,
      where: legacyWhere,
      update: this.toCanonicalKeys(model, update),
    });
  };

  delete: CustomAdapter["delete"] = async ({ model, where }) => {
    if (this.modelOf(model) === "passkey") {
      const passkeyId = this.exactRecordId(model, where);
      if (passkeyId === null) {
        throw refused(
          new IdentityUnsupportedStorageQueryError(
            "identity storage adapter: better-auth issued a passkey delete that was not one exact id equality. Passkey deletion is guarded atomically and cannot fall through to an unguarded storage delete.",
          ),
        );
      }
      const outcome = await this.deps.passkeyRemoval.deleteIfAnotherWayInRemains({ passkeyId });
      if (outcome === "would_strand_user") {
        throw APIError.from("BAD_REQUEST", {
          code: "LAST_WAY_IN",
          message:
            "This is the only way you can sign in. Add another sign-in method first, then remove this one.",
        });
      }
      return;
    }
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({
        model,
        operation: "delete",
        where,
      });
      if (rows !== null) {
        await this.detachOnIdentityBranch(rows);
        return;
      }
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return;
      await this.deps.legacy.delete({ model, where: translated });
      return;
    }
    await this.deps.legacy.delete({ model, where });
  };

  deleteMany: CustomAdapter["deleteMany"] = async ({ model, where }) => {
    if (this.modelOf(model) === "account") {
      const rows = await this.routeAccount({
        model,
        operation: "deleteMany",
        where,
      });
      if (rows !== null) {
        return this.detachOnIdentityBranch(rows, {
          // Every account row of one user, named by nothing else, is better-auth erasing
          // that user: `deleteUser` fans this out before `user.delete.before` runs.
          erasingUser: this.isWholeUserScope(model, where),
        });
      }
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return 0;
      return this.deps.legacy.deleteMany({ model, where: translated });
    }
    return this.deps.legacy.deleteMany({ model, where });
  };

  // Verification consumption and rate-limit counters act only on models
  // nothing routes, so both delegate unconditionally (ADR-116 §1).
  consumeOne: CustomAdapter["consumeOne"] = async ({ model, where }) => {
    const row = await this.deps.legacy.consumeOne<Row>({ model, where });
    return row === null ? null : (this.toStorageKeys(model, row) as never);
  };

  incrementOne: CustomAdapter["incrementOne"] = async ({ model, where, increment, set }) => {
    const row = await this.deps.legacy.incrementOne<Row>({
      model,
      where,
      increment: this.toCanonicalKeys(model, increment) as Record<string, number>,
      set: set === undefined ? undefined : this.toCanonicalKeys(model, set),
    });
    return row === null ? null : (this.toStorageKeys(model, row) as never);
  };

  /**
   * Unlink, and the fan-out a user delete performs (ADR-116 §8): a detach
   */
  private readonly detachOnIdentityBranch = async (
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

/** better-auth's own value for a secret it wrote: an expiry arrives as a `Date`. */
function toSecretValue(value: unknown): unknown {
  return value instanceof Date ? fromDate(value) : (value ?? null);
}

/** An identity row as better-auth reads it: every moment back to the `Date` it expects. */
function toBetterAuthAccount(row: IdentityAccountRow): Row {
  return {
    ...row,
    accessTokenExpiresAt: row.accessTokenExpiresAt ? toDate(row.accessTokenExpiresAt) : null,
    refreshTokenExpiresAt: row.refreshTokenExpiresAt ? toDate(row.refreshTokenExpiresAt) : null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

/** A read missing with `identity_identifier_not_found` is `missing`; other failures throw. */
async function readIdentified<T>(
  read: Promise<T>,
): Promise<{ kind: "found"; value: T } | { kind: "missing" }> {
  try {
    return { kind: "found", value: await read };
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === IDENTIFIER_NOT_FOUND) {
      return { kind: "missing" };
    }
    throw error;
  }
}

function refuseOrderedAccountRead({
  sorted,
  offset,
}: {
  sorted: boolean;
  offset: number | undefined;
}): void {
  if (!sorted && (offset ?? 0) <= 0) return;
  throw new IdentityUnsupportedStorageQueryError(
    `identity storage adapter: better-auth issued an account findMany with ${sorted ? "a sort" : "an offset"}. ` +
      "The identity branch serves a user's sign-in methods unordered and unpaged; teach it the ordering the caller needs rather than guessing one.",
  );
}

function identityCustomAdapter(
  deps: IdentityStorageRoutingDeps,
): AdapterFactoryCustomizeAdapterCreator {
  return (naming) => surfacingHandledRefusals(new IdentityStorageRouting(deps, naming).adapter());
}

/** Every method wrapped once; a new required adapter method fails to compile here. */
function surfacingHandledRefusals(adapter: CustomAdapter): CustomAdapter {
  return {
    create: (input) => surfaceHandledRefusals(() => adapter.create(input)),
    update: (input) => surfaceHandledRefusals(() => adapter.update(input)),
    updateMany: (input) => surfaceHandledRefusals(() => adapter.updateMany(input)),
    findOne: (input) => surfaceHandledRefusals(() => adapter.findOne(input)),
    findMany: (input) => surfaceHandledRefusals(() => adapter.findMany(input)),
    delete: (input) => surfaceHandledRefusals(() => adapter.delete(input)),
    deleteMany: (input) => surfaceHandledRefusals(() => adapter.deleteMany(input)),
    consumeOne: (input) => surfaceHandledRefusals(() => adapter.consumeOne(input)),
    incrementOne: (input) => surfaceHandledRefusals(() => adapter.incrementOne(input)),
    count: (input) => surfaceHandledRefusals(() => adapter.count(input)),
  };
}

/**
 * The adapter boundary's translation (ADR-116 §6): a `HandledError` becomes
 */
async function surfaceHandledRefusals<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!HandledError.isHandled(error)) throw error;
    throw new APIError(
      httpStatusFor(error.httpStatus),
      { code: error.code, message: error.message, cause: error },
      undefined,
      error.httpStatus,
    );
  }
}

/** better-auth's status vocabulary, from ours. Anything unmapped is a 500,
 *  which is the honest answer for a status the library cannot name. */
function httpStatusFor(
  httpStatus: number,
):
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "UNPROCESSABLE_ENTITY"
  | "TOO_MANY_REQUESTS"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR" {
  switch (httpStatus) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 410:
      return "GONE";
    case 422:
      return "UNPROCESSABLE_ENTITY";
    case 429:
      return "TOO_MANY_REQUESTS";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL_SERVER_ERROR";
  }
}
