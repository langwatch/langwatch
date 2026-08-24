import type { DBAdapter } from "better-auth";
import type { IdentityAccountStore } from "./account-store";

/** better-auth's adapter contract — the engine this one fronts. */
export type RowEngine = DBAdapter;

/**
 * better-auth's `account` model, served by identity (ADR-116 §3).
 *
 * Every OTHER model — `user`, `session`, `verification`, `ratelimit`, and
 * anything a plugin mounts — delegates to the stock `prismaAdapter`
 * untouched, method for method. Only `account` is intercepted, and only
 * because that is the one model whose truth moved.
 *
 * **This is not the routing facade ADR-101 §2 removed.** That one kept
 * better-auth's storage AND emitted events, so every linkage fact existed
 * twice and a parity check had to prove they agreed. This one REPLACES
 * storage for one model: reads are `Identifier` ⋈ `AccountCredential`, and
 * the linkage half of a write is a command. There is one copy.
 *
 * **The fallback is the migration, not a hedge.** A user whose backfill has
 * not finalized has no identifiers, so the projection answers nothing and
 * the read falls through to the legacy `Account` table — which is still
 * their truth, and the only truth they have. It is deleted when no user is
 * unmigrated, and until then ADR-110's rule holds exactly: per user, one
 * source of truth.
 *
 * Writes that create or remove an account are NOT here. They are ceremonies
 * (`IdentityCeremonies`), because an account appearing is a domain event
 * whatever caused it; this class only serves reads and the secrets.
 */
export class IdentityAccountAdapter implements RowEngine {
  readonly id: string;
  readonly createSchema: RowEngine["createSchema"];
  readonly options: RowEngine["options"];

  constructor(
    private readonly base: RowEngine,
    private readonly accounts: IdentityAccountStore,
  ) {
    this.id = base.id;
    this.createSchema = base.createSchema;
    this.options = base.options;
  }

  private isAccount(model: string): boolean {
    return model === "account";
  }

  readonly findOne: RowEngine["findOne"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.findOne(data);
    const row = await this.accounts.findOne({ where: data.where as never });
    // Null is not "no such account" here — it is "identity does not answer
    // for this one", which during migration is the common case.
    return (row ?? (await this.base.findOne(data))) as never;
  };

  readonly findMany: RowEngine["findMany"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.findMany(data);
    const rows = await this.accounts.findMany({ where: data.where as never });
    return (rows.length > 0 ? rows : await this.base.findMany(data)) as never;
  };

  readonly count: RowEngine["count"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.count(data);
    const rows = await this.accounts.findMany({ where: data.where as never });
    return rows.length > 0 ? rows.length : this.base.count(data);
  };

  readonly update: RowEngine["update"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.update(data) as never;
    const rows = await this.accounts.update({
      where: data.where as never,
      update: data.update,
    });
    return (rows[0] ?? (await this.base.update(data))) as never;
  };

  readonly updateMany: RowEngine["updateMany"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.updateMany(data);
    const rows = await this.accounts.update({
      where: data.where as never,
      update: data.update,
    });
    return rows.length > 0 ? rows.length : this.base.updateMany(data);
  };

  /**
   * The credential row goes; the identifier's detach is the ceremony's, run
   * by the `account.delete.before` hook before better-auth reaches here.
   */
  readonly delete: RowEngine["delete"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.delete(data);
    const rows = await this.accounts.findMany({ where: data.where as never });
    if (rows.length === 0) return this.base.delete(data);
    await this.accounts.deleteCredentials({ ids: rows.map((row) => row.id) });
  };

  readonly deleteMany: RowEngine["deleteMany"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.deleteMany(data);
    const rows = await this.accounts.findMany({ where: data.where as never });
    if (rows.length === 0) return this.base.deleteMany(data);
    return this.accounts.deleteCredentials({ ids: rows.map((row) => row.id) });
  };

  /**
   * An account create for a migrated user is written by the ceremony that
   * ran in `account.create.before`: the identifier is already appended and
   * folded by the time better-auth gets here, and the credential row is what
   * remains. For an unmigrated user the stock engine writes the legacy row,
   * exactly as it does today.
   */
  readonly create: RowEngine["create"] = async (data) => {
    if (!this.isAccount(data.model)) return this.base.create(data) as never;
    const row = data.data as Record<string, unknown>;
    const userId = row.userId;
    if (
      typeof userId !== "string" ||
      !(await this.accounts.serves({ userId }))
    ) {
      return this.base.create(data) as never;
    }
    const written = await this.accounts.createCredentialFor({ row });
    return (written ?? (await this.base.create(data))) as never;
  };

  readonly consumeOne: RowEngine["consumeOne"] = async (data) =>
    this.base.consumeOne(data) as never;

  readonly incrementOne: RowEngine["incrementOne"] = async (data) =>
    this.base.incrementOne(data) as never;

  /**
   * The transactional engine, re-wrapped — NOT handed over bare.
   *
   * This is load-bearing rather than tidy. better-auth runs sign-up inside
   * `adapter.transaction`, and every read and write in there goes to the
   * engine the callback receives; during a sign-up it is the ONLY method it
   * calls on this adapter at all. Passing `callback` through unchanged hands
   * better-auth the stock engine for the whole transaction, so `account`
   * stops being intercepted exactly where accounts are created.
   *
   * The credential write inside still goes through this class's own
   * repository, which is not enlisted in better-auth's transaction. A
   * rolled-back sign-up can therefore leave a credential row behind. It is
   * inert — nothing can reach a credential whose identifier was never
   * folded — and `create` is idempotent on the id the ceremony pinned, so a
   * retry adopts it rather than colliding.
   */
  readonly transaction: RowEngine["transaction"] = (callback) =>
    this.base.transaction((engine) => {
      // The transactional engine is narrower than a full adapter (no
      // `transaction` of its own), so it is widened to wrap and narrowed
      // back on the way out. The wrapping is the point; the casts only
      // reconcile the two shapes better-auth uses for the same thing.
      const wrapped = new IdentityAccountAdapter(
        engine as unknown as RowEngine,
        this.accounts,
      );
      return callback(wrapped as unknown as Parameters<typeof callback>[0]);
    });
}
