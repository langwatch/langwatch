import type { TenantMigrationOutcome, TenantMigrationRecord } from "./types";

/**
 * One in-place migration, written against the tenant it is given and nothing
 * else. Implementations live beside the domain they migrate (the ADR-092
 * stage-B backfill lives in `@langwatch/authz-server`); this package only
 * drives them.
 */
export interface SystemMigration {
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
   *
   * Cloud never reads this. Self-hosted has no operator pacing at all (the
   * in-place doctrine: nobody ever learns a migration happened), so its
   * pacing is this declaration: an OSS release can ship a migration's code
   * while cloud is still migrating and soaking, and the migration stays
   * inert on every self-hosted installation - the runner does not drive it
   * for any tenant, so it is never attempted, parked or reported - until a
   * later release flips this to `true`. Flipping it IS the self-hosted
   * release act, made only after the cloud rollout has soaked.
   */
  readonly runsAutomaticallyOnSelfHosted: boolean;

  /**
   * Whether CLOUD puts every tenant in this migration's cohort with no
   * operator action.
   *
   * The counterpart to `runsAutomaticallyOnSelfHosted` on the other
   * installation, and a different axis from it: this one is about WHO, that
   * one about WHETHER the installation drives the migration at all.
   *
   * `false` is the soaking posture: on cloud the migration processes only
   * the tenants an operator has enrolled from the ops migrations page, so a
   * release ships it dark and the rollout widens deliberately. `true` says
   * the rollout is over - the migration has already run for the tenants that
   * existed and must now reach every tenant, including every one created
   * since, without an operator remembering to enroll it. Enrollment rows for
   * such a migration decide nothing, so the ops page stops offering them.
   *
   * Self-hosted ignores this exactly as cloud ignores
   * `runsAutomaticallyOnSelfHosted`: off cloud every tenant is in every
   * driven migration's cohort already.
   */
  readonly enrolledAutomatically: boolean;

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
