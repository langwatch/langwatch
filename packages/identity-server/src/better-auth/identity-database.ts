import type { Where } from "better-auth";
import type { AccountCeremony } from "./account-ceremony";
import type { AdapterRows } from "./adapter-rows";
import type { DbAdapter } from "./adapter-types";
import type { TransactionWriteGuard } from "./transaction-write-guard";
import type { UserCeremony } from "./user-ceremony";
import type { WriteOperation, WriteRouting } from "./write-routing";

/**
 * The identity adapter (ADR-101 §2, R10): better-auth's `database` contract
 * implemented as OUR adapter — a routing facade whose row engine is the
 * stock prismaAdapter. better-auth still never writes the database except
 * through this seam; what the facade adds is the routing decision and the
 * ceremonies it dispatches:
 *
 *   - Every WRITE is looked up in the routing table. An unrouted write — a
 *     new better-auth model or operation nobody has classified — throws,
 *     loudly, on first use; the app's coverage test pins the current
 *     surface so the failure lands in CI before it lands in production.
 *   - `protocol` writes delegate straight to the row engine: byte-identical
 *     to stock behavior, no events (R12 — session rows, token refreshes,
 *     verification bookkeeping).
 *   - `domain` writes run their ceremony FIRST, so the guards veto before
 *     any row exists and a refused ceremony refuses the protocol write too.
 *   - READS delegate untouched.
 *
 * The class implements `DbAdapter` member by member rather than spreading
 * the row engine. Spreading hides the boundary: a member better-auth adds
 * in a future version appears silently, already delegating, and no test
 * fails. Written out, the seam is the file — every read that delegates says
 * so, and every write states its route.
 *
 * This object holds its collaborators for the lifetime of one better-auth
 * options instance, which is why it is a class and not a bag of closures.
 */
export class IdentityDatabase implements DbAdapter {
  readonly id: string;
  readonly createSchema: DbAdapter["createSchema"];
  readonly options: DbAdapter["options"];

  constructor(
    private readonly base: DbAdapter,
    private readonly routing: WriteRouting,
    private readonly rows: AdapterRows,
    private readonly accounts: AccountCeremony,
    private readonly users: UserCeremony,
    private readonly transactions: TransactionWriteGuard,
  ) {
    this.id = base.id;
    this.createSchema = base.createSchema;
    this.options = base.options;
  }

  // ---- reads: delegated untouched -------------------------------------

  readonly findOne: DbAdapter["findOne"] = (data) => this.base.findOne(data);
  readonly findMany: DbAdapter["findMany"] = (data) => this.base.findMany(data);
  readonly count: DbAdapter["count"] = (data) => this.base.count(data);

  // ---- writes: routed, and dispatched to a ceremony when domain --------

  readonly create: DbAdapter["create"] = async (args) => {
    const route = this.routing.routeOf({
      model: args.model,
      operation: "create",
    });
    const isDomain = route === "domain";
    const created = await this.base.create(
      isDomain && args.model === "account"
        ? {
            ...args,
            data: (await this.accounts.beforeCreate(
              args.data as Record<string, unknown>,
            )) as never,
            forceAllowId: true,
          }
        : args,
    );
    if (isDomain && args.model === "user") {
      const userId = (created as { id?: unknown } | null)?.id;
      if (typeof userId === "string") {
        await this.users.afterCreate({ userId });
      }
    }
    return created as never;
  };

  readonly update: DbAdapter["update"] = async (args) => {
    this.routing.routeOf({ model: args.model, operation: "update" });
    return this.base.update(args) as never;
  };

  readonly updateMany: DbAdapter["updateMany"] = async (args) => {
    this.routing.routeOf({ model: args.model, operation: "updateMany" });
    return this.base.updateMany(args);
  };

  readonly delete: DbAdapter["delete"] = async (args) => {
    const ids = await this.ceremonyIds({ operation: "delete", args });
    // The ceremony ran and selected nothing: there is no row to delete, and
    // re-evaluating the caller's predicate could find one that started
    // matching mid-flight.
    if (ids !== null && ids.length === 0) return;
    return this.base.delete(ids === null ? args : this.rows.pinTo(args, ids));
  };

  readonly deleteMany: DbAdapter["deleteMany"] = async (args) => {
    const ids = await this.ceremonyIds({ operation: "deleteMany", args });
    if (ids !== null && ids.length === 0) return 0;
    return this.base.deleteMany(
      ids === null ? args : this.rows.pinTo(args, ids),
    );
  };

  readonly consumeOne: DbAdapter["consumeOne"] = async (args) => {
    this.routing.routeOf({ model: args.model, operation: "consumeOne" });
    return this.base.consumeOne(args) as never;
  };

  readonly incrementOne: DbAdapter["incrementOne"] = async (args) => {
    this.routing.routeOf({ model: args.model, operation: "incrementOne" });
    return this.base.incrementOne(args) as never;
  };

  readonly transaction: DbAdapter["transaction"] = (callback) =>
    this.base.transaction((trx) => callback(this.transactions.wrap(trx)));

  /**
   * The ceremony for a destructive write, and the ids it selected — or null
   * when the write is protocol, in which case the caller's own predicate
   * stands. Routing happens here and nowhere else, so a ceremony never has
   * to ask whether it should have been called.
   */
  private async ceremonyIds({
    operation,
    args,
  }: {
    operation: Extract<WriteOperation, "delete" | "deleteMany">;
    args: { model: string; where: Where[] };
  }): Promise<string[] | null> {
    const route = this.routing.routeOf({ model: args.model, operation });
    if (route !== "domain") return null;
    if (args.model === "account") {
      return this.accounts.beforeDelete({ where: args.where });
    }
    if (args.model === "user") {
      return this.users.beforeDelete({ where: args.where });
    }
    return null;
  }
}
