import type { TenantMigrationOutcome, TenantMigrationRecord } from "./types";

/**
 * One in-place migration, written against the tenant it is given and nothing
 * else. Implementations live beside the domain they migrate (the ADR-092
 * stage-B backfill lives in `@langwatch/authz-server`); this package only
 * drives them.
 */
export interface SystemMigration {
  /**
   * Stable identifier - the state table's key and the name operators see.
   * Renaming it orphans every stored record, so never do that.
   */
  readonly name: string;

  /**
   * Migrate one tenant. The contract that makes the runner safe to re-run
   * on every boot:
   *
   * - Idempotent: a second call after any outcome creates nothing new.
   * - Self-proving: `finalized` may only be returned when the migration
   *   verified the tenant behaves identically without its legacy path.
   * - Held is not failed: return `migrated` when the work landed but the
   *   proof found disagreements - the tenant stays on its legacy path,
   *   behaviour unchanged, and later passes retry the proof.
   * - Throwing parks the tenant; the runner records the error and retries
   *   on a later pass.
   *
   * `previous` is the tenant's stored record, or null when it has never
   * run. A migration whose writes land before its bookkeeping does needs it:
   * a `parked` previous attempt is the signal that work may have committed
   * without the follow-up that makes it visible, so this pass must redo the
   * follow-up rather than short-circuit on "nothing left to write".
   *
   * `signal` aborts a long pass at shutdown. Honour it between units of
   * work - the runner will not interrupt an in-flight call.
   */
  migrateTenant(args: {
    tenantId: string;
    signal?: AbortSignal;
    previous?: TenantMigrationRecord | null;
  }): Promise<TenantMigrationOutcome>;
}
