import { HandledError } from "@langwatch/handled-error";
import { normalizeIdentifierValue } from "@langwatch/identity";
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
import { isSsoConnectionId } from "../sso-connection-id";
import {
  type AccountQuery,
  type AccountWhere,
  IdentityUnsupportedStorageQueryError,
  issuerForProviderId,
  parseAccountQuery,
  providerIdFromIssuer,
} from "./account-queries";
import type { IdentityAccountCeremonies } from "./ceremony-types";
import {
  anyBornInThisRequest,
  birthAwareGate,
  currentIdentityBirth,
  type IdentityBirthPort,
  recordIdentityBirth,
} from "./identity-birth";
import type {
  IdentityAccountRow,
  IdentityAccountSecrets,
  IdentityAccountsPort,
  IdentityConnectionIssuersPort,
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
  /**
   * The issuer each connection registered, both ways. Required rather than
   * optional: without it the legacy branch silently cannot serve a single
   * connection, which is the shape of failure this port exists to end.
   */
  connectionIssuers: IdentityConnectionIssuersPort;
  ceremonies: IdentityAccountCeremonies;
  /** ADR-116 §2: `finalized` and nothing else, cached, fail-closed. */
  isUserOnIdentityWrites: IdentityUserGate;
  /**
   * Whether ANY user has finalized, fleet-wide — the same pre-rollout
   * short-circuit the write gate already reads.
   *
   * The per-user gate cannot be asked about a query that names no user, and
   * §7's loud failure must not catch a population it can never serve: on a
   * fleet where nobody has latched, an `account` shape the branch has not
   * enumerated belongs to a legacy user by construction and has to run
   * untouched. Fail-closed here means "legacy", exactly as the per-user gate's
   * does.
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
  connectionIssuers,
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
     *
     * The gate, plus the answer it cannot give for a user this request just
     * bore: their state row says `finalized`, but the gate reads it on
     * another connection behind a TTL cache that answered before they
     * existed. Wrapped HERE as well as at the composition root, so an
     * application that composes the adapter without wrapping still cannot
     * route a newborn's account write to the legacy table.
     */
    const routesToIdentity = birthAwareGate(isUserOnIdentityWrites);

    /** The same fork asked of the fleet, for a query that names nobody. */
    const anyoneRoutesToIdentity = async (): Promise<boolean> =>
      anyBornInThisRequest() || (await isAnyoneOnIdentityWrites());

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
     *
     * A query that names nobody — a row id, a provider subject — is decided by
     * the FLEET-level question instead, never by parsing it first.
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

    /**
     * Whether an `account` write is scoped to one user and NOTHING else —
     * every row they hold, named by no provider, subject or row id.
     *
     * That shape reaches `deleteMany` from exactly one place: better-auth
     * erasing the user. A delete that names anything further is somebody
     * unlinking a method, and must keep meeting the guards that decide
     * whether removing it would strand them.
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
        (clause.operator === undefined ||
          clause.operator.toLowerCase() === "eq") &&
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
    /**
     * The row as better-auth 1.7 expects it, carrying the issuer half of its
     * account key.
     *
     * The identifier STORES the issuer — stated on the attach, exactly as
     * better-auth decided it — so the stored value is served verbatim. The
     * derivation is a floor for a row attached before the fact carried one,
     * and never a preference: a real OIDC connection's issuer is its own URL,
     * and no rule of ours would arrive at it. Deriving over a stored value
     * would hand back `local:oauth:google` for an account better-auth keyed
     * by `https://accounts.google.com`, and it would look like a missing
     * sign-in method rather than a wrong column.
     */
    const withIssuer = (row: IdentityAccountRow): IdentityAccountRow => ({
      ...row,
      issuer: row.issuer ?? issuerForProviderId(row.providerId),
    });

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
        case "byUserProviderSubject": {
          // The user is named, so the gate is decidable without resolving the
          // subject first — and the row is read under that user, which is
          // what keeps a subject collision between two IdPs from answering
          // with the wrong person's account.
          if (!(await routesToIdentity({ userId: query.userId }))) return null;
          const row = await accounts.findByProviderSubject({
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
          // The IdP callback's resolution read: no user is named, so the
          // identity tables are consulted FIRST and answer only when the
          // resolved user is finalized (ADR-116 §2). A miss, or a held
          // user, falls through to the legacy row that is still their
          // truth.
          //
          // Keyed on better-auth's own `providerId`, verbatim - NOT on the
          // folded identifier vocabulary. `identifierProviderFor` collapses
          // auth0, okta and every custom OIDC connection into `oidc`, and a
          // provider subject is unique only WITHIN an issuer, so matching on
          // the fold lets one enterprise IdP's subject resolve another IdP's
          // user. `Account` is unique on this same pair; the identity branch
          // namespaces identically.
          const resolved = await resolution.resolveByProviderSubject({
            providerId: query.providerId,
            providerAccountId: query.accountId,
          });
          if (!resolved?.finalized) return null;
          const row = await accounts.findByProviderSubject({
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
      const served = await serveAccounts(
        parseAccountQuery({ operation, where: canonical }),
      );
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

    /**
     * A `user` update on the identity branch, with `email` taken out of it
     * (ADR-116 §6) — or the update exactly as it arrived.
     *
     * `User.email` has ONE writer for a latched user: the fold, from their
     * PRIMARY identifier. So the column write is REMOVED here and the
     * address is stated as a command instead. Everything else in the same
     * update — name, image, `lastLoginAt` — passes through untouched, which
     * matters because most user updates carry no email at all and must not
     * become a different kind of write just because this branch exists.
     *
     * A user the query does not NAME cannot be routed, and a population-wide
     * update that set `email` would be a shape nothing issues; those fall
     * through to the legacy branch, where they always were.
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

    /**
     * better-auth 1.7's issuer, translated back into the only vocabulary the
     * legacy `Account` table speaks.
     *
     * The table predates the issuer half of 1.7's account key: it has no
     * issuer column, and the provider id is the row's whole truth. 1.7 still
     * sends the issuer — synthesised from the provider id for every provider
     * that declares none — and handing that clause to the legacy engine is a
     * `PrismaClientValidationError` on a column that does not exist, which
     * reached customers as "two-step verification wouldn't start". So on the
     * legacy branch the clause is translated rather than passed through:
     *
     * - an issuer beside the providerId it was minted from is the same fact
     *   said twice, and is dropped;
     * - an issuer standing alone in one of the synthetic forms is rewritten
     *   to the providerId it encodes;
     * - an issuer the table cannot answer — a real OIDC issuer URL, or one
     *   contradicting the providerId beside it — answers NO ROWS (`null`
     *   here). Dropping such a clause instead would widen the query, and a
     *   widened account key is how one IdP's subject resolves another IdP's
     *   user.
     */
    /*
     * IT HANDS BACK A MUTABLE ARRAY, and that is not a detail. It takes a
     * `readonly` list because it does not write to what it is given, and it
     * used to hand the same list straight back on the two paths that change
     * nothing — so `readonly` travelled out with it, into a binding
     * better-auth types as mutable. Seven assignments failed to typecheck for
     * a variance that says nothing about this function's behaviour.
     *
     * Copying on those two paths costs one shallow copy on a lookup that has
     * already decided to do nothing, and it means every caller gets the same
     * shape whichever branch answered.
     *
     * IT ALSO TAKES A LIST RATHER THAN A MAYBE-LIST. Handing it `undefined`
     * only ever got `undefined` straight back, which is not a translation and
     * put an `undefined` in the return type that four of the seven callers —
     * the ones better-auth guarantees a `where` to — then had to talk their
     * way out of. The two callers that genuinely hold an optional one skip
     * the call instead, which is what "there is nothing to translate" means.
     */
    const legacyAccountWhere = async (
      model: string,
      where: readonly CleanedWhere[],
    ): Promise<CleanedWhere[] | null> => {
      const canonicalNameOf = (clause: CleanedWhere): string =>
        getDefaultFieldName({ model, field: clause.field });
      const issuerClause = where.find(
        (clause) => canonicalNameOf(clause) === "issuer",
      );
      if (issuerClause === undefined) return [...where];
      const issuer = issuerClause.value;
      if (
        (issuerClause.operator?.toLowerCase() ?? "eq") !== "eq" ||
        typeof issuer !== "string"
      ) {
        return null;
      }
      const rest = where.filter((clause) => clause !== issuerClause);
      const derived = providerIdFromIssuer(issuer);
      const providerClause = rest.find(
        (clause) => canonicalNameOf(clause) === "providerId",
      );
      if (providerClause !== undefined) {
        const providerId = providerClause.value;
        if (typeof providerId !== "string") return null;
        // The issuer was minted from this very provider id: the same fact
        // twice, and the table already keys by the half it holds.
        if (derived === providerId) return rest;
        // AN ISSUER WE DID NOT MINT, BESIDE A CONNECTION. This is not a
        // contradiction, it is the ordinary shape of single sign-on: a
        // connection's issuer is its identity provider's real URL, which
        // decodes to no provider id because we never encoded one into it.
        //
        // Refusing it was refusing every RETURNING person on a connection.
        // The first sign-in created the row, the next one could not find it,
        // and better-auth created it again — straight into the unique
        // constraint on (provider, providerAccountId), which reached the
        // person as "Something went wrong signing you in".
        //
        // Nothing is widened by answering: the provider id is a connection
        // id, unique to one identity provider by construction, so the key
        // stays exactly as specific as it was. A built-in provider beside a
        // foreign issuer stays unanswerable, which is the case that would
        // resolve one provider's subject onto another's.
        if (derived === null && isSsoConnectionId(providerId)) return rest;
        return null;
      }

      // AN ISSUER STANDING ALONE, which is the shape that actually matters:
      // `findAccountOwnerByKey` — the OAuth callback's lookup — sends the
      // issuer and the subject and NO provider id at all. A synthetic issuer
      // decodes; a connection's real one has to be looked up, because the
      // connection wrote it down when it registered.
      const registered =
        derived === null
          ? await connectionIssuers.providerIdForIssuer({ issuer })
          : derived;
      // Still nobody's: an issuer no connection registered and no provider id
      // encodes. Widening to "any provider" here is precisely how one
      // identity provider's subject would resolve another's user.
      if (registered === null) return null;
      return [
        ...rest,
        { ...issuerClause, field: "providerId", value: registered },
      ];
    };

    /** The same column, kept out of a legacy WRITE: the engine would refuse
     *  a field its schema does not hold, and the synthetic value carries
     *  nothing the provider id does not already say. */
    const withoutIssuerColumn = (model: string, data: Row): Row =>
      Object.fromEntries(
        Object.entries(data).filter(
          ([field]) => getDefaultFieldName({ model, field }) !== "issuer",
        ),
      );

    /**
     * And minted back onto every account row the legacy branch serves, for
     * the same reason `withIssuer` mints it on the identity branch: 1.7
     * checks the issuer on rows it is handed — a credential row without one
     * fails its own `local:credential` comparison, which reaches the person
     * as a wrong password. Every legacy row's issuer is the synthetic form,
     * because the legacy table never stored a real one: a provider with an
     * issuer of its own arrived after the identity branch existed to hold it.
     */
    const withLegacyIssuer = async (model: string, row: Row): Promise<Row> => {
      if (modelOf(model) !== "account") return row;
      if (row.issuer != null) return row;
      const providerId = row.providerId;
      if (typeof providerId !== "string") return row;
      // A CONNECTION GETS THE ISSUER IT REGISTERED, not a synthetic one.
      // 1.7 compares the issuer on the row it is handed against the issuer
      // the ceremony is running for (`acc.issuer === account.issuer`, and
      // again under `requireExactAccountBinding`). Minting `local:oauth:<id>`
      // for a connection fails that comparison every time, so finding the row
      // at all would not have been enough on its own.
      const registered = await connectionIssuers.registeredIssuerFor({
        providerId,
      });
      return {
        ...row,
        issuer: registered ?? issuerForProviderId(providerId),
      };
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
          data: (modelOf(model) === "account"
            ? withoutIssuerColumn(model, canonical)
            : canonical) as never,
          select,
          // Ids are generated by THIS factory's `transformInput`, so by the
          // time the data reaches here `data.id` is already the id the
          // caller will see. Without this the legacy engine's own factory
          // would drop it and mint a second one — and the account id a
          // ceremony pinned would stop being the row's.
          forceAllowId: true,
        });
        return toStorageKeys(model, await withLegacyIssuer(model, row)) as never;
      },

      findOne: async ({ model, where, select, join }) => {
        let legacyWhere = where;
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
          const translated = await legacyAccountWhere(model, where);
          if (translated === null) return null;
          legacyWhere = translated;
        }
        const found = await legacy.findOne<Row>({
          model,
          where:
            modelOf(model) === "user"
              ? await resolveUserWhere(model, legacyWhere)
              : legacyWhere,
          select,
          join,
        });
        return found === null
          ? null
          : (toStorageKeys(model, await withLegacyIssuer(model, found)) as never);
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
        let legacyWhere = where;
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
            return rows
              .slice(0, limit)
              .map((row) => toStorageKeys(model, { ...row })) as never;
          }
          // A findMany with no `where` asks for every account row, and there
          // is nothing in "everything" to translate — the issuer clause the
          // translation exists for is exactly what is absent.
          if (where !== undefined) {
            const translated = await legacyAccountWhere(model, where);
            if (translated === null) return [] as never;
            legacyWhere = translated;
          }
        }
        const found = await legacy.findMany<Row>({
          model,
          where:
            modelOf(model) === "user" && legacyWhere !== undefined
              ? await resolveUserWhere(model, legacyWhere)
              : legacyWhere,
          limit,
          select,
          sortBy,
          offset,
          join,
        });
        return (await Promise.all(
          found.map(async (row) =>
            toStorageKeys(model, await withLegacyIssuer(model, row)),
          ),
        )) as never;
      },

      count: async ({ model, where }) => {
        if (modelOf(model) === "account") {
          const rows = await routeAccount({ model, operation: "count", where });
          if (rows !== null) return rows.length;
          // Counting every account row has no issuer clause to translate, so
          // it goes to the legacy engine exactly as it arrived.
          if (where === undefined) return legacy.count({ model });
          const translated = await legacyAccountWhere(model, where);
          if (translated === null) return 0;
          return legacy.count({ model, where: translated });
        }
        return legacy.count({ model, where });
      },

      update: async ({ model, where, update }) => {
        let legacyWhere = where;
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
          const translated = await legacyAccountWhere(model, where);
          if (translated === null) return null;
          legacyWhere = translated;
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
            return found === null
              ? null
              : (toStorageKeys(model, found) as never);
          }
          const updated = await legacy.update<Row>({
            model,
            where,
            update: toCanonicalKeys(model, remaining),
          });
          return updated === null
            ? null
            : (toStorageKeys(model, updated) as never);
        }
        const canonicalUpdate = toCanonicalKeys(model, update as Row);
        const row = await legacy.update<Row>({
          model,
          where: legacyWhere,
          update:
            modelOf(model) === "account"
              ? withoutIssuerColumn(model, canonicalUpdate)
              : canonicalUpdate,
        });
        return row === null
          ? null
          : (toStorageKeys(model, await withLegacyIssuer(model, row)) as never);
      },

      updateMany: async ({ model, where, update }) => {
        let legacyWhere = where;
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
          const translated = await legacyAccountWhere(model, where);
          if (translated === null) return 0;
          legacyWhere = translated;
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
        const canonicalUpdate = toCanonicalKeys(model, update);
        return legacy.updateMany({
          model,
          where: legacyWhere,
          update:
            modelOf(model) === "account"
              ? withoutIssuerColumn(model, canonicalUpdate)
              : canonicalUpdate,
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
          const translated = await legacyAccountWhere(model, where);
          if (translated === null) return;
          await legacy.delete({ model, where: translated });
          return;
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
              // Every account row of one user, named by nothing else, is
              // better-auth erasing that user: `deleteUser` fans this out
              // before `user.delete.before` runs. The erase is stated ONCE by
              // `beforeUserDelete`, so the rows go without a detach apiece —
              // which is also what keeps the strands guard, written for
              // unlinking a method from a LIVING user, from refusing to let a
              // user holding one way in be deleted at all.
              erasingUser: isWholeUserScope(model, where),
            });
          }
          const translated = await legacyAccountWhere(model, where);
          if (translated === null) return 0;
          return legacy.deleteMany({ model, where: translated });
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
     * fact per identifier, and both secret-bearing rows removed with them.
     *
     * The bridge `Account` row is deleted HERE rather than left to the fold.
     * The fold does remove it — a tombstoned identifier projects to no row —
     * but only once it runs, and the mirror (§4) has been writing this user's
     * newest password onto that row all along. A window in which the row
     * outlives the unlink is a window in which the fail-closed fallback to the
     * legacy branch still authenticates the method the customer just removed.
     * The fold's own delete stays as the replay-time answer; this one is what
     * makes the unlink true when it returns.
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
