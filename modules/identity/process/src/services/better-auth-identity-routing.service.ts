import { IdentityUnsupportedStorageQueryError } from "@langwatch/identity-contract";
import type { CleanedWhere, CustomAdapter, DBAdapter } from "better-auth/adapters";
import { APIError } from "better-auth/api";

import {
  type AccountWhere,
  issuerForProviderId,
  providerIdFromIssuer,
} from "../rules/better-auth-account-queries.rules.ts";
import {
  type AdapterNaming,
  canonicalKeysOf,
  canonicalWhereOf,
  isWholeUserScope,
  refuseOrderedAccountRead,
  storageKeysOf,
  type StorageRow as Row,
  toBetterAuthAccount,
} from "../rules/better-auth-storage-rows.rules.ts";
import type { IdentityAccountRow, IdentityAccounts } from "../rules/identity-storage.rules.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";
import { BetterAuthAccountBranchService } from "./better-auth-account-branch.service.ts";
import type { PasskeyRemoval } from "./better-auth-identity-storage.service.ts";
import type { BetterAuthUserBranchService } from "./better-auth-user-branch.service.ts";

/** One instance per better-auth options: `legacy` and `naming` are bound at adapter-factory
 *  time, so app/ composes this and both branches inside the factory it hands the storage. */
interface IdentityStorageRoutingDeps {
  legacy: DBAdapter;
  naming: AdapterNaming;
  accounts: IdentityAccounts;
  isUserOnIdentityWrites: IdentityUserGate;
  passkeyRemoval: PasskeyRemoval;
  accountBranch: BetterAuthAccountBranchService;
  userBranch: BetterAuthUserBranchService;
}

/** The adapter better-auth's factory customizes: every routed read and write, one method each. */
export class BetterAuthIdentityRoutingService {
  static create(deps: IdentityStorageRoutingDeps): BetterAuthIdentityRoutingService {
    return new BetterAuthIdentityRoutingService(deps);
  }

  private readonly accounts: BetterAuthAccountBranchService;

  private readonly users: BetterAuthUserBranchService;

  private readonly naming: AdapterNaming;

  private constructor(private readonly deps: IdentityStorageRoutingDeps) {
    this.accounts = deps.accountBranch;
    this.users = deps.userBranch;
    this.naming = deps.naming;
  }

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

  private readonly toCanonicalKeys = (model: string, data: Row): Row =>
    canonicalKeysOf({ naming: this.naming, model, data });

  private readonly toStorageKeys = (model: string, row: Row): Row =>
    storageKeysOf({ naming: this.naming, model, row });

  private readonly canonicalWhere = (
    model: string,
    where: readonly CleanedWhere[] | undefined,
  ): AccountWhere[] => canonicalWhereOf({ naming: this.naming, model, where });

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
        const written = await this.accounts.createOnIdentityBranch(canonical);
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
      const rows = await this.accounts.routeAccount({
        operation: "findOne",
        where: this.canonicalWhere(model, where),
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
          ? await this.users.resolveUserWhere(model, legacyWhere)
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
      const rows = await this.accounts.routeAccount({
        operation: "findMany",
        where: this.canonicalWhere(model, where),
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
          ? await this.users.resolveUserWhere(model, legacyWhere)
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
      const rows = await this.accounts.routeAccount({
        operation: "count",
        where: this.canonicalWhere(model, where),
      });
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
    await this.accounts.applySecrets({
      rows: [first],
      secrets: this.accounts.secretsOfUpdate("update", this.toCanonicalKeys(model, update), [
        first,
      ]),
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
    const remaining = await this.users.withoutRoutedEmail({ model, where, update });
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
      const rows = await this.accounts.routeAccount({
        operation: "update",
        where: this.canonicalWhere(model, where),
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
      const rows = await this.accounts.routeAccount({
        operation: "updateMany",
        where: this.canonicalWhere(model, where),
      });
      if (rows !== null) {
        await this.accounts.applySecrets({
          rows,
          secrets: this.accounts.secretsOfUpdate(
            "updateMany",
            this.toCanonicalKeys(model, update),
            rows,
          ),
        });
        return rows.length;
      }
      const translated = await this.legacyAccountWhere(model, where);
      if (translated === null) return 0;
      legacyWhere = translated;
    }
    if (this.modelOf(model) === "user") {
      const remaining = await this.users.withoutRoutedEmail({ model, where, update });
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
        throw BetterAuthAccountBranchService.refused(
          new IdentityUnsupportedStorageQueryError(
            "identity storage adapter: better-auth issued a passkey delete that was not one exact id equality. " +
              "Passkey deletion is guarded atomically and cannot fall through to an unguarded storage delete.",
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
      const rows = await this.accounts.routeAccount({
        operation: "delete",
        where: this.canonicalWhere(model, where),
      });
      if (rows !== null) {
        await this.accounts.detachOnIdentityBranch(rows);
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
      const rows = await this.accounts.routeAccount({
        operation: "deleteMany",
        where: this.canonicalWhere(model, where),
      });
      if (rows !== null) {
        return this.accounts.detachOnIdentityBranch(rows, {
          // Every account row of one user, named by nothing else, is better-auth erasing
          // that user: `deleteUser` fans this out before `user.delete.before` runs.
          erasingUser: isWholeUserScope(this.canonicalWhere(model, where)),
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
}
