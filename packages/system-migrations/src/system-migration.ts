import type { TenantMigrationOutcome, TenantMigrationRecord } from "./types.ts";

/**
 * One in-place migration, written against the tenant it is given. Implementations
 * live beside the domain they migrate (ADR-092's stage-B backfill lives in
 * `@langwatch/authz-server`); this package only drives them.
 */
export interface SystemMigration {
  /** Boot execution policy; omitted migrations retain the background default. */
  readonly executionMode?: "background" | "startup";
  /** Whether a held outcome must prevent startup. Defaults to finite. */
  readonly startupSettlement?: "finite" | "recurring";
  /**
   * Stable identifier - the state table's key. Renaming it orphans every
   * stored record, so never do that; what operators read is `title`.
   */
  readonly name: string;

  /**
   * The name operators read on the ops page. Presentation over the stable
   * `name`, so it may change freely.
   */
  readonly title: string;

  /**
   * What this migration does for an organization, in the operator's
   * language: the change it makes and whether it affects who answers
   * permission checks. Shown verbatim on the ops page.
   */
  readonly description: string;

  /**
   * True for a migration whose finalization changes how the running fleet
   * behaves; false for dark preparation work. Set deliberately - a migration
   * that forgets this gets no confirmation gate at all.
   */
  readonly requiresOperatorConfirmation: boolean;

  /**
   * Self-hosted has no operator pacing: shipping `false` keeps the migration
   * inert until a later release flips it - that flip IS the self-hosted
   * release act, made only once the cloud rollout has soaked.
   */
  readonly runsAutomaticallyOnSelfHosted: boolean;

  /**
   * `false` is the soaking posture on CLOUD - only tenants an operator
   * enrolled are processed; `true` means the rollout is over and every
   * tenant, including future ones, is included automatically.
   */
  readonly enrolledAutomatically: boolean;

  /**
   * Safe to re-run every boot: idempotent and self-proving (`finalized`
   * only once verified without the legacy path). `migrated` is not
   * failed - proof disagreed, so it stays on the legacy path to retry.
   */
  migrateTenant(args: {
    tenantId: string;
    /** Aborts a long pass at shutdown; honour it between units of work. */
    signal?: AbortSignal;
    /**
     * Null when never run. A `parked` previous attempt means work may have
     * committed without the follow-up that makes it visible, so redo it
     * rather than short-circuit on "nothing left to write".
     */
    previous?: TenantMigrationRecord | null;
  }): Promise<TenantMigrationOutcome>;
}
