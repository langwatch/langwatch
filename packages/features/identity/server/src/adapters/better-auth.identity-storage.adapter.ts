import { HandledError } from "@langwatch/handled-error";
import { normalizeIdentifierValue } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import type {
  AdapterFactory,
  AdapterFactoryConfig,
  AdapterFactoryCustomizeAdapterCreator,
  CleanedWhere,
  CustomAdapter,
  DBAdapter,
} from "better-auth/adapters";
import { createAdapterFactory } from "better-auth/adapters";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules";
import {
  type AccountQuery,
  type AccountWhere,
  BetterAuthAccountQueriesAdapter,
  IdentityUnsupportedStorageQueryError,
} from "./better-auth.account-queries.adapter";
import type { IdentityAccountCeremonies } from "../rules/ceremony-types.rules";
import { BetterAuthIdentityBirthAdapter } from "./better-auth.identity-birth.adapter";
import type { IdentityBirthPort } from "../ports/identity-birth.port";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
  IdentityResolutionPort,
} from "../rules/identity-storage-ports.rules";

const logger = createLogger("langwatch:identity:storage-adapter");

/**
 * A refusal, logged on its way out. better-auth catches an adapter throw and turns it into a
 * redirect carrying the error CODE and nothing else, so an unlogged refusal reaches the
 * customer as a sign-in error page and leaves NOTHING behind to diagnose it with.
 */
const refused = <T>(error: T): T => {
  if (error instanceof IdentityUnsupportedStorageQueryError) {
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
  field === "issuer"
    ? (row.issuer ?? BetterAuthAccountQueriesAdapter.issuerForProviderId(row.providerId))
    : row[field];

export interface IdentityStorageAdapterDeps {
  /**
   * better-auth's own published storage engine, built (`prismaAdapter(...)`,
   * `memoryAdapter(...)`) but not yet bound to options. The legacy branch delegates to it
   * verbatim, so an unlatched user's behavior is byte-for-byte what the stock adapter did.
   */
  legacyEngine: (options: BetterAuthOptions) => DBAdapter;
  accounts: IdentityAccountsPort;
  resolution: IdentityResolutionPort;
  ceremonies: IdentityAccountCeremonies;
  /** ADR-116 §2: `finalized` and nothing else, cached, fail-closed. */
  isUserOnIdentityWrites: IdentityUserGate;
  /**
   * Whether ANY user has finalized, fleet-wide — the same pre-rollout short-circuit the write
   * gate already reads.
   */
  isAnyoneOnIdentityWrites: () => Promise<boolean>;
  /**
   * ADR-116 §3's entrance, reached only inside a request the auth route
   * boundary marked. Outside one this is never called, which is what keeps a
   * deploy of the entrance from changing anything on its own.
   */
  birth: IdentityBirthPort;
}

/**
 * better-auth's one `database:` entry (ADR-116 §1): an identity-owned
 */
export class BetterAuthIdentityStorageAdapter {
  static create(deps: IdentityStorageAdapterDeps): BetterAuthIdentityStorageAdapter {
    return new BetterAuthIdentityStorageAdapter(deps);
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

function identityCustomAdapter({
  legacy,
  accounts,
  resolution,
  ceremonies,
  isUserOnIdentityWrites,
  isAnyoneOnIdentityWrites,
  birth,
}: Omit<IdentityStorageAdapterDeps, "legacyEngine"> & {
  legacy: DBAdapter;
}): AdapterFactoryCustomizeAdapterCreator {
  return ({ getDefaultModelName, getDefaultFieldName, getFieldName }) => {
    const modelOf = (model: string): string => getDefaultModelName(model);

    /**
     * The write fork, as every routed write asks it (ADR-116 §2, §3).
     */
    const routesToIdentity = BetterAuthIdentityBirthAdapter.birthAwareGate(isUserOnIdentityWrites);

    /** The same fork asked of the fleet, for a query that names nobody. */
    const anyoneRoutesToIdentity = async (): Promise<boolean> =>
      BetterAuthIdentityBirthAdapter.anyBornInThisRequest() || (await isAnyoneOnIdentityWrites());

    const toCanonicalKeys = (model: string, data: Row): Row =>
      Object.fromEntries(
        Object.entries(data).map(([field, value]) => [
          getDefaultFieldName({ model, field }),
          value,
        ]),
      );

    const toStorageKeys = (model: string, row: Row): Row =>
      Object.fromEntries(
        Object.entries(row).map(([field, value]) => [getFieldName({ model, field }), value]),
      );

    const canonicalWhere = (
      model: string,
      where: readonly CleanedWhere[] | undefined,
    ): AccountWhere[] =>
      (where ?? []).map((clause) => ({
        ...clause,
        field: getDefaultFieldName({ model, field: clause.field }),
      }));

    /**
     * The user a query names outright, when it names one.
     */
    const namedUserId = (where: readonly AccountWhere[]): string | null => {
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
    const isWholeUserScope = (
      model: string,
      where: readonly CleanedWhere[] | undefined,
    ): boolean => {
      const canonical = canonicalWhere(model, where);
      const clause = canonical[0];
      return (
        canonical.length === 1 &&
        clause !== undefined &&
        clause.field === "userId" &&
        (clause.operator === undefined || clause.operator.toLowerCase() === "eq") &&
        typeof clause.value === "string"
      );
    };

    /** The record a `user` query names outright — the same narrowing
     *  `namedUserId` applies, one field over, because on the `user` model the
     *  user IS the record. */
    const namedRecordId = (where: readonly AccountWhere[]): string | null => {
      const clause = where.find(
        (candidate) =>
          candidate.field === "id" &&
          (candidate.operator === undefined || candidate.operator === "eq") &&
          (candidate.connector === undefined || candidate.connector.toUpperCase() === "AND"),
      );
      return typeof clause?.value === "string" ? clause.value : null;
    };

    const secretsOf = (row: Row): IdentityAccountSecrets =>
      Object.fromEntries(
        SECRET_FIELDS.filter((field) => field in row).map((field) => [field, row[field] ?? null]),
      );

    /**
     * A better-auth `account` update is a token refresh or a password change — secrets, and
     * nothing else. A payload that names a linkage column is asking the branch to rewrite what
     * only a command may state, so it refuses rather than dropping the field silently.
     */
    const secretsOfUpdate = (
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
            `identity storage adapter: better-auth issued an account ${operation} that writes linkage columns (${foreign.sort().join(", ")}). ` +
              "Linkage is event-truth on the identity branch, so it can only be stated as a command, never written as a column.",
          ),
        );
      }
      return secretsOf(update);
    };

    /**
     * The row as better-auth 1.7 expects it, carrying the issuer half of its account key. The
     * identifier STORES the issuer — stated on the attach, exactly as better-auth decided it —
     * so the stored value is served verbatim.
     */
    const withIssuer = (row: IdentityAccountRow): IdentityAccountRow => ({
      ...row,
      issuer: row.issuer ?? BetterAuthAccountQueriesAdapter.issuerForProviderId(row.providerId),
    });

    const serveAccounts = async (query: AccountQuery): Promise<IdentityAccountRow[] | null> => {
      switch (query.kind) {
        case "byUser":
          return accounts.findByUser({ userId: query.userId });
        case "byUserAndProvider": {
          const rows = await accounts.findByUser({ userId: query.userId });
          return rows.filter((row) => row.providerId === query.providerId);
        }
        case "byUserProviderSubject": {
          // The user is named, so the gate is decidable without resolving the
          // subject first — and the row is read under that user, which is
          // what keeps a subject collision between two IdPs from answering
          // with the wrong person's account.
          if (!(await routesToIdentity({ userId: query.userId }))) return null;
          const row = await accounts.tryFindByProviderSubject({
            userId: query.userId,
            providerId: query.providerId,
            providerAccountId: query.accountId,
          });
          return row === null ? null : [row];
        }
        case "byId":
        case "byIds": {
          // A row id names no user, so the projection read comes FIRST and is
          // what tells us whose account it is; the gate then decides. That
          // costs an indexed lookup on a user the gate would have closed
          // anyway, and there is no cheaper order — the id is the only handle
          // the caller gave us.
          const ids = query.kind === "byId" ? [query.id] : query.ids;
          const rows = await accounts.findByAccountIds({ accountIds: ids });
          if (rows.length === 0) return null;
          const served: IdentityAccountRow[] = [];
          for (const row of rows) {
            if (await routesToIdentity({ userId: row.userId })) {
              served.push(row);
            }
          }
          return served.length > 0 ? served : null;
        }
        case "byProviderSubject": {
          // The IdP callback's resolution read: no user is named, so the identity tables are
          // consulted FIRST and answer only when the
          // resolved user is finalized (ADR-116 §2). A miss, or a held
          const resolved = await resolution.tryResolveByProviderSubject({
            providerId: query.providerId,
            providerAccountId: query.accountId,
          });
          if (!resolved?.finalized) return null;
          const row = await accounts.tryFindByProviderSubject({
            userId: resolved.userId,
            providerId: query.providerId,
            providerAccountId: query.accountId,
          });
          return row === null ? null : [row];
        }
      }
    };

    const routeAccount = async ({
      model,
      operation,
      where,
    }: {
      model: string;
      operation: string;
      where: readonly CleanedWhere[] | undefined;
    }): Promise<IdentityAccountRow[] | null> => {
      const canonical = canonicalWhere(model, where);
      const named = namedUserId(canonical);
      if (named !== null) {
        if (!(await routesToIdentity({ userId: named }))) return null;
      } else if (!(await anyoneRoutesToIdentity())) {
        // Nobody is on the identity branch, so no `account` query can be one
        // of its — including a shape §7 would otherwise refuse. This is what
        // makes deploying the adapter change nothing for a fleet where no
        // operator has enrolled anyone.
        return null;
      }
      let query: AccountQuery;
      try {
        query = BetterAuthAccountQueriesAdapter.parseAccountQuery({ operation, where: canonical });
      } catch (error) {
        throw refused(error);
      }
      const served = await serveAccounts(query);
      return served === null ? null : served.map(withIssuer);
    };

    const applySecrets = async ({
      rows,
      secrets,
    }: {
      rows: readonly IdentityAccountRow[];
      secrets: IdentityAccountSecrets;
    }): Promise<void> => {
      if (Object.keys(secrets).length === 0) return;
      const accountIds = rows.map((row) => row.id);
      await accounts.updateCredentials({ accountIds, secrets });
      await accounts.mirrorSecretsOntoAccounts({ accountIds, secrets });
    };

    /**
     * An account create on the identity branch: the linkage is a fact, the
     * secrets are a row (ADR-116 §6).
     */
    const createOnIdentityBranch = async (canonical: Row): Promise<IdentityAccountRow | null> => {
      const { userId, providerId } = canonical;
      if (typeof userId !== "string" || typeof providerId !== "string") {
        return null;
      }
      const pinned = await ceremonies.tryBeforeAccountCreate({
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
      const accountId = pinned?.data.id;
      if (accountId === undefined) return null;

      const secrets = secretsOf(canonical);
      await accounts.createCredential({
        accountId,
        userId,
        providerId,
        secrets,
      });
      await accounts.mirrorSecretsOntoAccounts({
        accountIds: [accountId],
        secrets,
      });
      const [written] = await accounts.findByAccountIds({
        accountIds: [accountId],
      });
      if (!written) {
        logger.warn(
          { userId, providerId, accountId },
          "the attached identifier is not in the projection yet; the account row falls back to the legacy write",
        );
        return null;
      }
      return written;
    };

    /**
     * The identifier-first half of `findUserByEmail` (ADR-116 §6): the
     */
    const resolveUserWhere = async (
      model: string,
      where: readonly CleanedWhere[],
    ): Promise<CleanedWhere[]> => {
      const clause = where[0];
      if (
        where.length !== 1 ||
        clause === undefined ||
        getDefaultFieldName({ model, field: clause.field }) !== "email" ||
        clause.operator !== "eq" ||
        typeof clause.value !== "string"
      ) {
        return [...where];
      }
      const resolved = await resolution.tryResolveByIdentifierValue({
        normalizedValue: normalizeIdentifierValue(clause.value),
      });
      if (!resolved?.finalized) return [...where];
      return [
        {
          field: getFieldName({ model, field: "id" }),
          value: resolved.userId,
          operator: "eq",
          connector: "AND",
          mode: "sensitive",
        },
      ];
    };

    /**
     * A `user` create inside a marked request: the born-finalized entrance
     * (ADR-116 §3), or nothing at all.
     */
    const bearOnIdentityBranch = async (canonical: Row): Promise<Row | null> => {
      if (BetterAuthIdentityBirthAdapter.currentIdentityBirth() === undefined) return null;
      const { email, createdAt } = canonical;
      if (typeof email !== "string" || email.length === 0) {
        logger.warn(
          { model: "user" },
          "a flagged request created a user with no email; the born-finalized entrance has no identifier to state, so the create takes the legacy branch",
        );
        return null;
      }
      const born = await birth.bear({
        row: canonical,
        email,
        createdAtMs: createdAt instanceof Date ? createdAt.getTime() : Date.now(),
      });
      // From here the request's remaining routed writes are this user's, and
      // the gate — which cannot see a state row written moments ago on
      // another connection — is answered by the marker instead.
      const bornId = born.id;
      if (typeof bornId === "string")
        BetterAuthIdentityBirthAdapter.recordIdentityBirth({ userId: bornId });
      return born;
    };

    /**
     * A `user` update on the identity branch, with `email` taken out of it
     * (ADR-116 §6) — or the update exactly as it arrived.
     */
    const withoutRoutedEmail = async ({
      model,
      where,
      update,
    }: {
      model: string;
      where: readonly CleanedWhere[] | undefined;
      update: Row;
    }): Promise<Row> => {
      const canonical = toCanonicalKeys(model, update);
      const email = canonical.email;
      if (typeof email !== "string") return update;
      const named = namedRecordId(canonicalWhere(model, where));
      if (named === null || !(await routesToIdentity({ userId: named }))) {
        return update;
      }
      await ceremonies.beforeEmailChange({ userId: named, email });
      return Object.fromEntries(
        Object.entries(update).filter(
          ([field]) => getDefaultFieldName({ model, field }) !== "email",
        ),
      );
    };

    const adapter: CustomAdapter = {
      create: async ({ model, data, select }) => {
        const canonical = toCanonicalKeys(model, data);
        if (modelOf(model) === "user") {
          const born = await bearOnIdentityBranch(canonical);
          if (born) return toStorageKeys(model, { ...born }) as never;
        }
        if (modelOf(model) === "account") {
          const userId = canonical.userId;
          if (typeof userId === "string" && (await routesToIdentity({ userId }))) {
            const written = await createOnIdentityBranch(canonical);
            if (written) return toStorageKeys(model, { ...written }) as never;
          }
        }
        const row = await legacy.create<Row, Row>({
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
        return toStorageKeys(model, row) as never;
      },

      findOne: async ({ model, where, select, join }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({
            model,
            operation: "findOne",
            where,
          });
          if (rows !== null) {
            const row = rows[0];
            return row ? (toStorageKeys(model, { ...row }) as never) : null;
          }
        }
        const found = await legacy.findOne<Row>({
          model,
          where: modelOf(model) === "user" ? await resolveUserWhere(model, where) : where,
          select,
          join,
        });
        return found === null ? null : (toStorageKeys(model, found) as never);
      },

      findMany: async ({ model, where, limit, select, sortBy, offset, join }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({
            model,
            operation: "findMany",
            where,
          });
          if (rows !== null) {
            // Refused only once the query is known to be the identity
            // branch's. The legacy engine has always served sorts and offsets,
            // and a fleet nobody has enrolled must keep getting that answer.
            if (sortBy !== undefined || (offset ?? 0) > 0) {
              throw new IdentityUnsupportedStorageQueryError(
                `identity storage adapter: better-auth issued an account findMany with ${sortBy ? "a sort" : "an offset"}. ` +
                  "The identity branch serves a user's sign-in methods unordered and unpaged; teach it the ordering the caller needs rather than guessing one.",
              );
            }
            return rows.slice(0, limit).map((row) => toStorageKeys(model, { ...row })) as never;
          }
        }
        const found = await legacy.findMany<Row>({
          model,
          where:
            modelOf(model) === "user" && where !== undefined
              ? await resolveUserWhere(model, where)
              : where,
          limit,
          select,
          sortBy,
          offset,
          join,
        });
        return found.map((row) => toStorageKeys(model, row)) as never;
      },

      count: async ({ model, where }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({ model, operation: "count", where });
          if (rows !== null) return rows.length;
        }
        return legacy.count({ model, where });
      },

      update: async ({ model, where, update }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({
            model,
            operation: "update",
            where,
          });
          if (rows !== null) {
            const first = rows[0];
            if (first === undefined) return null;
            await applySecrets({
              rows: [first],
              secrets: secretsOfUpdate("update", toCanonicalKeys(model, update as Row), [first]),
            });
            const [fresh] = await accounts.findByAccountIds({
              accountIds: [first.id],
            });
            return fresh === undefined ? null : (toStorageKeys(model, { ...fresh }) as never);
          }
        }
        if (modelOf(model) === "user") {
          const remaining = await withoutRoutedEmail({
            model,
            where,
            update: update as Row,
          });
          // An update that was ONLY the email has nothing left to write —
          // the command is the whole change — so the row is READ back rather
          // than written with an empty patch.
          if (Object.keys(remaining).length === 0) {
            const found = await legacy.findOne<Row>({ model, where });
            return found === null ? null : (toStorageKeys(model, found) as never);
          }
          const updated = await legacy.update<Row>({
            model,
            where,
            update: toCanonicalKeys(model, remaining),
          });
          return updated === null ? null : (toStorageKeys(model, updated) as never);
        }
        const row = await legacy.update<Row>({
          model,
          where,
          update: toCanonicalKeys(model, update as Row),
        });
        return row === null ? null : (toStorageKeys(model, row) as never);
      },

      updateMany: async ({ model, where, update }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({
            model,
            operation: "updateMany",
            where,
          });
          if (rows !== null) {
            await applySecrets({
              rows,
              secrets: secretsOfUpdate("updateMany", toCanonicalKeys(model, update), rows),
            });
            return rows.length;
          }
        }
        if (modelOf(model) === "user") {
          const remaining = await withoutRoutedEmail({ model, where, update });
          if (Object.keys(remaining).length === 0) return 1;
          return legacy.updateMany({
            model,
            where,
            update: toCanonicalKeys(model, remaining),
          });
        }
        return legacy.updateMany({
          model,
          where,
          update: toCanonicalKeys(model, update),
        });
      },

      delete: async ({ model, where }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({
            model,
            operation: "delete",
            where,
          });
          if (rows !== null) {
            await detachOnIdentityBranch(rows);
            return;
          }
        }
        await legacy.delete({ model, where });
      },

      deleteMany: async ({ model, where }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({
            model,
            operation: "deleteMany",
            where,
          });
          if (rows !== null) {
            return detachOnIdentityBranch(rows, {
              // Every account row of one user, named by nothing else, is better-auth erasing
              // that user: `deleteUser` fans this out before `user.delete.before` runs.
              erasingUser: isWholeUserScope(model, where),
            });
          }
        }
        return legacy.deleteMany({ model, where });
      },

      // Verification consumption and rate-limit counters act only on models
      // nothing routes, so both delegate unconditionally (ADR-116 §1).
      consumeOne: async ({ model, where }) => {
        const row = await legacy.consumeOne<Row>({ model, where });
        return row === null ? null : (toStorageKeys(model, row) as never);
      },

      incrementOne: async ({ model, where, increment, set }) => {
        const row = await legacy.incrementOne<Row>({
          model,
          where,
          increment: toCanonicalKeys(model, increment) as Record<string, number>,
          set: set === undefined ? undefined : toCanonicalKeys(model, set),
        });
        return row === null ? null : (toStorageKeys(model, row) as never);
      },
    };

    /**
     * Unlink, and the fan-out a user delete performs (ADR-116 §8): a detach
     */
    async function detachOnIdentityBranch(
      rows: readonly IdentityAccountRow[],
      { erasingUser = false }: { erasingUser?: boolean } = {},
    ): Promise<number> {
      // An erase states itself, whole, through `beforeUserDelete`. Detaching
      // each row on the way would state the same removal twice and would ask
      // a guard about stranding a user who is being erased.
      if (!erasingUser) {
        for (const row of rows) {
          await ceremonies.beforeAccountDelete({
            id: row.id,
            userId: row.userId,
            providerId: row.providerId,
          });
        }
      }
      const accountIds = rows.map((row) => row.id);
      await accounts.deleteCredentials({ accountIds });
      await accounts.deleteBridgeAccounts({ accountIds });
      return rows.length;
    }

    // Every method, wrapped once, rather than ten try/catch blocks that a
    // new method could silently be added beside.
    return Object.fromEntries(
      Object.entries(adapter).map(([name, method]) => [
        name,
        async (...args: never[]) =>
          surfaceHandledRefusals(() =>
            (method as (...called: never[]) => Promise<unknown>)(...args),
          ),
      ]),
    ) as unknown as CustomAdapter;
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
