import { HandledError } from "@langwatch/handled-error";
import {
  identifierProviderFor,
  normalizeIdentifierValue,
} from "@langwatch/identity";
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
import type { IdentityUserGate } from "../identity-user-gate";
import {
  type AccountQuery,
  type AccountWhere,
  IdentityUnsupportedStorageQueryError,
  parseAccountQuery,
} from "./account-queries";
import type { IdentityAccountCeremonies } from "./ceremony-types";
import {
  birthAwareGate,
  currentIdentityBirth,
  type IdentityBirthPort,
  recordIdentityBirth,
} from "./identity-birth";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
  IdentityResolutionPort,
} from "./storage-ports";

const logger = createLogger("langwatch:identity:storage-adapter");

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

export interface IdentityStorageAdapterDeps {
  /**
   * better-auth's own published storage engine, built (`prismaAdapter(...)`,
   * `memoryAdapter(...)`) but not yet bound to options. The legacy branch
   * delegates to it verbatim, so an unlatched user's behavior is
   * byte-for-byte what the stock adapter did.
   */
  legacyEngine: (options: BetterAuthOptions) => DBAdapter;
  accounts: IdentityAccountsPort;
  resolution: IdentityResolutionPort;
  ceremonies: IdentityAccountCeremonies;
  /** ADR-116 §2: `finalized` and nothing else, cached, fail-closed. */
  isUserOnIdentityWrites: IdentityUserGate;
  /**
   * ADR-116 §3's entrance, reached only inside a request the auth route
   * boundary marked. Outside one this is never called, which is what keeps a
   * deploy of the entrance from changing anything on its own.
   */
  birth: IdentityBirthPort;
}

/**
 * better-auth's one `database:` entry (ADR-116 §1): an identity-owned
 * adapter built with `createAdapterFactory`, in which a per-user gate routes
 * between the stock behavior and event-sourced storage.
 *
 * **We are the implementation the factory is built AROUND, never a wrapper
 * over a finished one.** That is not a preference. `findUserByEmail(email, {
 * includeAccounts: true })` asks for the user with `join: { account: true }`,
 * and with joins off — the default — the factory satisfies that join itself
 * by issuing a second query through the instance it was built around. Sign-up
 * runs inside `adapter.transaction`, which for that request is the only method
 * better-auth calls on the adapter at all. Both of those land BELOW a wrapper
 * and ON us at this level.
 *
 * ## The transform constraint
 *
 * The factory's own transforms stay ON here, and that is forced rather than
 * chosen. `handleFallbackJoin` runs INSIDE `transformOutput`, so a factory
 * configured with `disableTransformOutput` never emulates the join at all —
 * it is not passed down either (`passJoinToAdapter` is false whenever the
 * factory computed one), so the joined read would silently come back without
 * its accounts. Keeping the transforms on is what makes the fallback join
 * ours.
 *
 * The consequence is that everything below this line speaks the STORAGE
 * level: mapped model names (`Account`), mapped column names (`provider`,
 * `access_token`), and rows to match. The legacy engine is a FINISHED
 * adapter whose own factory transforms again, so delegating to it has to
 * cross back to better-auth's canonical field names and back out — which is
 * what `toCanonicalKeys` / `toStorageKeys` do, using the factory's own name
 * helpers rather than a table of our own. `where` clauses need no crossing:
 * `getDefaultFieldName` resolves a mapped name back to its canonical field,
 * so re-transforming an already-mapped clause is a no-op.
 *
 * ## Transaction
 *
 * `transaction` is left unset, which makes the factory hand better-auth the
 * as-is passthrough — no real transaction, the same thing the application
 * ran with the stock `prismaAdapter`. The identity branch invents no
 * cross-branch transactional promise, and preserving the existing behavior
 * exactly is the point.
 */
export function createIdentityStorageAdapter(
  deps: IdentityStorageAdapterDeps,
): AdapterFactory<BetterAuthOptions> {
  return (options) =>
    createAdapterFactory({
      config: identityAdapterConfig,
      adapter: identityCustomAdapter({
        ...deps,
        legacy: deps.legacyEngine(options),
      }),
    })(options);
}

/**
 * Value coercion is deliberately absent: every `supports*` flag is on, so
 * this factory maps NAMES and leaves shapes alone. The legacy engine's own
 * factory knows what its store accepts and coerces there, and the identity
 * ports take Postgres shapes directly — a second coercion here could only
 * disagree with one of them.
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
  birth,
}: Omit<IdentityStorageAdapterDeps, "legacyEngine"> & {
  legacy: DBAdapter;
}): AdapterFactoryCustomizeAdapterCreator {
  return ({ getDefaultModelName, getDefaultFieldName, getFieldName }) => {
    const modelOf = (model: string): string => getDefaultModelName(model);

    /**
     * The write fork, as every routed write asks it (ADR-116 §2, §3).
     *
     * The gate, plus the answer it cannot give for a user this request just
     * bore: their state row says `finalized`, but the gate reads it on
     * another connection behind a TTL cache that answered before they
     * existed. Wrapped HERE as well as at the composition root, so an
     * application that composes the adapter without wrapping still cannot
     * route a newborn's account write to the legacy table.
     */
    const routesToIdentity = birthAwareGate(isUserOnIdentityWrites);

    const toCanonicalKeys = (model: string, data: Row): Row =>
      Object.fromEntries(
        Object.entries(data).map(([field, value]) => [
          getDefaultFieldName({ model, field }),
          value,
        ]),
      );

    const toStorageKeys = (model: string, row: Row): Row =>
      Object.fromEntries(
        Object.entries(row).map(([field, value]) => [
          getFieldName({ model, field }),
          value,
        ]),
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
     *
     * This is what keeps §7's loud failure from catching the wrong
     * population: a shape the branch does not serve must fail for a
     * finalized user and run untouched for everyone else, and the gate can
     * only be asked once a user is known. A clause that is not a plain
     * `AND`-connected equality is not a user this query is scoped to.
     */
    const namedUserId = (where: readonly AccountWhere[]): string | null => {
      const clause = where.find(
        (candidate) =>
          candidate.field === "userId" &&
          (candidate.operator === undefined || candidate.operator === "eq") &&
          (candidate.connector === undefined ||
            candidate.connector.toUpperCase() === "AND"),
      );
      return typeof clause?.value === "string" ? clause.value : null;
    };

    const secretsOf = (row: Row): IdentityAccountSecrets =>
      Object.fromEntries(
        SECRET_FIELDS.filter((field) => field in row).map((field) => [
          field,
          row[field] ?? null,
        ]),
      );

    /**
     * A better-auth `account` update is a token refresh or a password
     * change — secrets, and nothing else. A payload that names a linkage
     * column is asking the branch to rewrite what only a command may state,
     * so it refuses rather than dropping the field silently.
     */
    const secretsOfUpdate = (
      operation: string,
      update: Row,
    ): IdentityAccountSecrets => {
      const foreign = Object.keys(update).filter(
        (field) =>
          !SECRET_FIELDS.some((secret) => secret === field) &&
          !UPDATE_PASSTHROUGH_FIELDS.some((passed) => passed === field),
      );
      if (foreign.length > 0) {
        throw new IdentityUnsupportedStorageQueryError(
          `identity storage adapter: better-auth issued an account ${operation} that writes linkage columns (${foreign.sort().join(", ")}). ` +
            "Linkage is event-truth on the identity branch, so it can only be stated as a command, never written as a column.",
        );
      }
      return secretsOf(update);
    };

    /**
     * The rows the identity branch serves for a query, or `null` when it
     * does not answer for this record at all and the legacy branch does.
     * An empty array is an ANSWER — this user holds no such account — and
     * is never a reason to read the legacy table as well.
     */
    const serveAccounts = async (
      query: AccountQuery,
    ): Promise<IdentityAccountRow[] | null> => {
      switch (query.kind) {
        case "byUser":
          return accounts.findByUser({ userId: query.userId });
        case "byUserAndProvider": {
          const rows = await accounts.findByUser({ userId: query.userId });
          return rows.filter((row) => row.providerId === query.providerId);
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
          // The IdP callback's resolution read: no user is named, so the
          // identity tables are consulted FIRST and answer only when the
          // resolved user is finalized (ADR-116 §2). A miss, or a held
          // user, falls through to the legacy row that is still their
          // truth.
          const provider = identifierProviderFor(query.providerId);
          const resolved = await resolution.resolveByProviderSubject({
            provider,
            providerAccountId: query.accountId,
          });
          if (!resolved?.finalized) return null;
          const row = await accounts.findByProviderSubject({
            userId: resolved.userId,
            provider,
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
      if (named !== null && !(await routesToIdentity({ userId: named }))) {
        return null;
      }
      return serveAccounts(parseAccountQuery({ operation, where: canonical }));
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
     *
     * The ceremony states the attach and its ledger waits for the fold, so
     * the identifier is in the projection by the time the credential row is
     * written and the assembled row can be read back. When it is not —
     * the ceremony declined, or the fold lagged past its window — this
     * answers null and the caller writes the legacy row instead. That is
     * the fail-closed direction the gate uses everywhere else: a row
     * better-auth can read beats a sign-up that fails. It can leave a
     * credential row nothing reaches, which is inert (no identifier names
     * it) and adopted rather than duplicated by the next attempt, because
     * the write is keyed by the id the ceremony pinned.
     */
    const createOnIdentityBranch = async (
      canonical: Row,
    ): Promise<IdentityAccountRow | null> => {
      const { userId, providerId } = canonical;
      if (typeof userId !== "string" || typeof providerId !== "string") {
        return null;
      }
      const pinned = await ceremonies.beforeAccountCreate({
        id: canonical.id,
        userId,
        providerId,
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
     * incoming value is D01-normalized and resolved against the identifiers,
     * and a finalized user's read becomes a read BY ID. The `User` row still
     * answers it — user-model reads are never routed, because the table is
     * complete for both populations — so only WHICH row changes, and sign-in
     * by any verified email is what that buys.
     *
     * Everything else is left exactly as it arrived, which is what keeps the
     * admin plugin's `contains` searches, counts and `OR` connectors serving
     * from the `User` table unchanged.
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
      const resolved = await resolution.resolveByIdentifierValue({
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
     *
     * Only a create that carries an email is a birth. better-auth's own
     * sign-up always does; anything else — a plugin minting a placeholder
     * user, an anonymous session — has no address to derive an identifier
     * from and takes the legacy branch, marker or not.
     */
    const bearOnIdentityBranch = async (
      canonical: Row,
    ): Promise<Row | null> => {
      if (currentIdentityBirth() === undefined) return null;
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
        createdAtMs:
          createdAt instanceof Date ? createdAt.getTime() : Date.now(),
      });
      // From here the request's remaining routed writes are this user's, and
      // the gate — which cannot see a state row written moments ago on
      // another connection — is answered by the marker instead.
      const bornId = born.id;
      if (typeof bornId === "string") recordIdentityBirth({ userId: bornId });
      return born;
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
          if (
            typeof userId === "string" &&
            (await routesToIdentity({ userId }))
          ) {
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
          where:
            modelOf(model) === "user"
              ? await resolveUserWhere(model, where)
              : where,
          select,
          join,
        });
        return found === null ? null : (toStorageKeys(model, found) as never);
      },

      findMany: async ({
        model,
        where,
        limit,
        select,
        sortBy,
        offset,
        join,
      }) => {
        if (modelOf(model) === "account") {
          if (sortBy !== undefined || (offset ?? 0) > 0) {
            throw new IdentityUnsupportedStorageQueryError(
              `identity storage adapter: better-auth issued an account findMany with ${sortBy ? "a sort" : "an offset"}. ` +
                "The identity branch serves a user's sign-in methods unordered and unpaged; teach it the ordering the caller needs rather than guessing one.",
            );
          }
          const rows = await routeAccount({
            model,
            operation: "findMany",
            where,
          });
          if (rows !== null) {
            return rows
              .slice(0, limit)
              .map((row) => toStorageKeys(model, { ...row })) as never;
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
              secrets: secretsOfUpdate(
                "update",
                toCanonicalKeys(model, update as Row),
              ),
            });
            const [fresh] = await accounts.findByAccountIds({
              accountIds: [first.id],
            });
            return fresh === undefined
              ? null
              : (toStorageKeys(model, { ...fresh }) as never);
          }
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
              secrets: secretsOfUpdate(
                "updateMany",
                toCanonicalKeys(model, update),
              ),
            });
            return rows.length;
          }
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
          if (rows !== null) return detachOnIdentityBranch(rows);
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
     * fact per identifier, and the credential rows removed with them. The
     * `Account` row itself is the fold's — a tombstoned identifier projects
     * to no row — so nothing here deletes it a second time.
     */
    async function detachOnIdentityBranch(
      rows: readonly IdentityAccountRow[],
    ): Promise<number> {
      for (const row of rows) {
        await ceremonies.beforeAccountDelete({
          id: row.id,
          userId: row.userId,
          providerId: row.providerId,
        });
      }
      await accounts.deleteCredentials({
        accountIds: rows.map((row) => row.id),
      });
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
 * a better-auth `APIError` carrying the stable `code`.
 *
 * Without it the code dies here. better-auth wraps a storage failure in its
 * own generic error — sign-up answers `FAILED_TO_CREATE_USER` and nothing
 * else — unless what it caught is already an `APIError`, which it re-throws
 * verbatim. So being an `APIError` is precisely what carries `code` out to
 * the auth error surface, where the client presentation registry turns it
 * into the words a customer reads. The original rides on `cause` for the log.
 *
 * Plain errors pass through untouched: they are the ones that SHOULD degrade
 * to a generic failure plus a trace id.
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
function httpStatusFor(httpStatus: number): "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "GONE" | "UNPROCESSABLE_ENTITY" | "TOO_MANY_REQUESTS" | "SERVICE_UNAVAILABLE" | "INTERNAL_SERVER_ERROR" {
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
