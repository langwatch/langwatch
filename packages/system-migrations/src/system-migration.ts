import type { TenantMigrationOutcome, TenantMigrationRecord } from "./types.ts";

/**
 * One in-place migration, written against the tenant it is given and nothing
 * else. Implementations live beside the domain they migrate (the ADR-092
 * stage-B backfill lives in `@langwatch/authz-server`); this package only
 * drives them.
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
   * Whether an operator action on this migration takes a typed destructive
   * confirmation. True for a migration whose finalization changes how the
   * running fleet behaves; false for dark preparation work. Declared here
   * so the gate that enforces it and the interface that renders it read the
   * same fact - a new behaviour-changing migration that forgets to set it
   * gets no confirmation at all, so set it deliberately.
   */
  readonly requiresOperatorConfirmation: boolean;

  /**
   * Whether a SELF-HOSTED installation runs this migration automatically.
   * Self-hosted has no operator pacing, so shipping this `false` keeps the
   * migration inert until a later release flips it — that flip IS the
   * self-hosted release act, made only after the cloud rollout has soaked.
   */
  readonly runsAutomaticallyOnSelfHosted: boolean;

  /**
   * Whether CLOUD puts every tenant in this migration's cohort with no
   * operator action. `false` is the soaking posture — only tenants an
   * operator enrolled are processed; `true` means the rollout is over and
   * every tenant, including future ones, is included automatically.
   */
  readonly enrolledAutomatically: boolean;

  /**
   * Migrate one tenant, safe to re-run on every boot: idempotent, and
   * self-proving (`finalized` only once verified without the legacy path).
   * Held is not failed — `migrated` means work landed but proof disagreed,
   * so the tenant stays on its legacy path for a later pass to retry.
   */
  migrateTenant(args: {
    tenantId: string;
    /** Aborts a long pass at shutdown; honour it between units of work. */
    signal?: AbortSignal;
    /**
     * The tenant's stored record, or null when never run. A `parked`
     * previous attempt signals work may have committed without the
     * follow-up that makes it visible, so redo it rather than
     * short-circuit on "nothing left to write".
     */
    previous?: TenantMigrationRecord | null;
  }): Promise<TenantMigrationOutcome>;
}
