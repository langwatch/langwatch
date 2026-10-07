import { SYSTEM_ACTORS } from "@langwatch/actor";
import { createLogger } from "@langwatch/observability";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { GrantsLedgerWriter } from "../authz/ledger";
import { computeNextRunAt } from "../scheduler/nextRunAt";
import type {
  ScheduledJobRepository,
  SchedulerHandler,
} from "../scheduler/scheduler.types";
import type { AggregateRuleService } from "./aggregate-rule.service";
import type {
  AggregateProjectRepository,
  AggregateReconcileLock,
} from "./repositories/aggregate-rule.repository";

const logger = createLogger("langwatch:projects:aggregate-reconciler");

/**
 * ADR-144 block E: the nightly catch-up for anything a trigger missed.
 *
 * One `ScheduledJob` row per aggregate project rather than per organisation,
 * because the scheduler keys every row by a project id; the organisation-level
 * entry point is {@link AggregateReconciler.reconcileOrganization}. 03:17 UTC,
 * off the hour on purpose.
 */
export const AGGREGATE_RECONCILE_SWEEP = {
  targetType: "aggregateReconcileSweep",
  cron: "17 3 * * *",
  timezone: "UTC",
} as const;

/** The revocation reason a reconciler-revoked shared read carries. */
export const AGGREGATE_RULE_NO_LONGER_MATCHES =
  "aggregate_rule_no_longer_matches";

/** The revocation reason every shared read of an archived aggregate carries. */
export const AGGREGATE_ARCHIVED = "aggregate_archived";

/** What the reconciler needs of the grants ledger, and nothing more. */
export type SharedProjectGrantsLedger = Pick<
  GrantsLedgerWriter,
  | "findLiveSharedProjectGrants"
  | "attachSharedProjectGrant"
  | "awaitSharedProjectGrants"
  | "revokeSharedProjectGrants"
>;

/** What the reconciler needs of the scheduler: one row per aggregate. */
export type AggregateSweepSchedule = Pick<
  ScheduledJobRepository,
  "upsertForTarget" | "deactivateForTarget" | "findAllForProject"
>;

/**
 * Member project ids, each in exactly one list. `failed` are members the rule
 * wants whose attach was refused; the next reconcile tries them again.
 */
export type AggregateReconcileResult = {
  attached: string[];
  revoked: string[];
  unchanged: string[];
  failed: string[];
};

export type OrganizationReconcileResult = {
  reconciled: Array<{
    aggregateProjectId: string;
    result: AggregateReconcileResult;
  }>;
  failed: Array<{ aggregateProjectId: string; error: Error }>;
};

/** What woke the reconciler, for the log line only. */
export type AggregateReconcileTrigger =
  | "aggregate-created"
  | "rule-edited"
  | "personal-workspace"
  | "department-assigned"
  | "member-offboarded"
  | "member-project-archived"
  | "nightly-sweep";

const NOTHING: AggregateReconcileResult = {
  attached: [],
  revoked: [],
  unchanged: [],
  failed: [],
};

const ACTOR = {
  type: "system",
  id: SYSTEM_ACTORS.aggregateReconciler,
} as const;

/**
 * ADR-144 decision 3: turns an aggregate project's rule into exactly one live
 * `project-reader` grant per member, and revokes the grant of every project
 * that stopped matching. The rule's meaning is {@link AggregateRuleService},
 * the grants are the ledger's; this only diffs the two and writes the
 * difference, so a second run attaches nothing and revokes nothing.
 *
 * Logs organisation and aggregate ids and counts only: never a condition,
 * never a rule beyond its kind.
 */
export class AggregateReconciler {
  constructor(
    private readonly deps: {
      aggregates: AggregateProjectRepository;
      /** Held around each reconcile, so two runs of one aggregate never overlap. */
      lock: AggregateReconcileLock;
      rules: Pick<AggregateRuleService, "membersOf">;
      /** Composed per call, like every ledger writer. */
      ledger: () => SharedProjectGrantsLedger;
      /** Absent where nothing schedules the sweep. */
      schedule?: AggregateSweepSchedule;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /**
   * Brings one aggregate's grants in line with its rule. A missing, archived
   * or rule-less aggregate reconciles nothing: an unreadable rule is not an
   * empty one, so it revokes nothing either.
   *
   * Runs under the aggregate's lock: two overlapping runs (a trigger and the
   * sweep, two admins' edits) would otherwise both read a member as missing
   * and both attach it, leaving two live rows for one pair.
   */
  async reconcile({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<AggregateReconcileResult> {
    return this.deps.lock.withAggregateLock({ aggregateProjectId }, () =>
      this.reconcileHoldingLock({ aggregateProjectId }),
    );
  }

  private async reconcileHoldingLock({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<AggregateReconcileResult> {
    const aggregate = await this.deps.aggregates.findAggregate({
      aggregateProjectId,
    });
    if (!aggregate || aggregate.archived) return NOTHING;
    const { organizationId } = aggregate;
    // Every reconcile, triggered or swept, puts back a sweep row that went
    // missing, so a failed schedule at creation is repaired by the next run.
    await this.ensureSweepScheduled({ organizationId, aggregateProjectId });
    if (!aggregate.rule) {
      // Reported as well as logged: nothing repairs a malformed column, and
      // the nightly sweep would otherwise say this once a night to a log
      // nobody reads while the aggregate's members drift.
      logger.error(
        { organizationId, aggregateProjectId },
        "aggregate project has a stored rule that does not parse; reconciling nothing",
      );
      captureException(
        new Error(
          "Aggregate project has a stored rule that does not parse; reconciling nothing",
        ),
        { extra: { organizationId, aggregateProjectId } },
      );
      return NOTHING;
    }

    const desired = new Set(
      await this.deps.rules.membersOf({
        rule: aggregate.rule,
        organizationId,
        aggregateProjectId,
      }),
    );
    const ledger = this.deps.ledger();
    const live = await ledger.findLiveSharedProjectGrants({
      organizationId,
      readerProjectId: aggregateProjectId,
    });
    const held = new Set(live.map((row) => row.memberProjectId));

    // Revocations first: a member that stopped matching must stop being read
    // even when an attach below fails.
    const revoked = [...held].filter((id) => !desired.has(id)).sort();
    if (revoked.length > 0) {
      await ledger.revokeSharedProjectGrants({
        organizationId,
        readerProjectId: aggregateProjectId,
        memberProjectIds: revoked,
        actor: ACTOR,
        reason: AGGREGATE_RULE_NO_LONGER_MATCHES,
      });
    }

    const unchanged = [...held].filter((id) => desired.has(id));
    const { attached, alreadyHeld, failed } = await this.attachMissing({
      ledger,
      organizationId,
      aggregateProjectId,
      missing: [...desired].filter((id) => !held.has(id)).sort(),
    });
    unchanged.push(...alreadyHeld);

    const result: AggregateReconcileResult = {
      attached,
      revoked,
      unchanged: unchanged.sort(),
      failed,
    };
    logger.info(
      {
        organizationId,
        aggregateProjectId,
        ruleKind: aggregate.rule.kind,
        attached: result.attached.length,
        revoked: result.revoked.length,
        unchanged: result.unchanged.length,
        failed: result.failed.length,
      },
      "reconciled aggregate project members",
    );
    return result;
  }

  /**
   * Attaches each missing member, then waits once for the whole batch: each
   * attach appends without waiting for its row, so ten members cost one
   * projection wait rather than ten. One refused attach is logged and listed,
   * and the rest still go ahead.
   */
  private async attachMissing({
    ledger,
    organizationId,
    aggregateProjectId,
    missing,
  }: {
    ledger: SharedProjectGrantsLedger;
    organizationId: string;
    aggregateProjectId: string;
    missing: string[];
  }): Promise<{ attached: string[]; alreadyHeld: string[]; failed: string[] }> {
    const attached: Array<{ memberProjectId: string; grantId: string }> = [];
    const alreadyHeld: string[] = [];
    const failed: Array<{ memberProjectId: string; error: Error }> = [];
    const from = this.now().toISOString();
    for (const memberProjectId of missing) {
      try {
        const outcome = await ledger.attachSharedProjectGrant({
          organizationId,
          readerProjectId: aggregateProjectId,
          memberProjectId,
          condition: { type: "trace", from },
          actor: ACTOR,
          source: "aggregate-reconciler",
          awaitProjection: false,
        });
        // Someone else attached the pair since the live read (a direct
        // ledger write, not another reconcile, which the lock keeps out);
        // its row is the one that stands.
        if (outcome.attached) {
          attached.push({ memberProjectId, grantId: outcome.grantId });
        } else {
          alreadyHeld.push(memberProjectId);
        }
      } catch (error) {
        failed.push({ memberProjectId, error: toError(error) });
      }
    }
    const [firstFailure] = failed;
    if (firstFailure) {
      logger.error(
        {
          organizationId,
          aggregateProjectId,
          failed: failed.length,
          error: firstFailure.error,
        },
        "some members of an aggregate project could not be attached; the next reconcile tries them again",
      );
      captureException(firstFailure.error, {
        extra: { organizationId, aggregateProjectId, failed: failed.length },
      });
    }
    await ledger.awaitSharedProjectGrants({
      organizationId,
      grantIds: attached.map((row) => row.grantId),
    });
    return {
      attached: attached.map((row) => row.memberProjectId),
      alreadyHeld,
      failed: failed.map((row) => row.memberProjectId),
    };
  }

  /**
   * Every live aggregate of the organisation, one after another. One
   * aggregate failing is logged and listed, and the rest still run.
   */
  async reconcileOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationReconcileResult> {
    const aggregateProjectIds = await this.deps.aggregates.findLiveAggregateIds(
      { organizationId },
    );
    const outcome: OrganizationReconcileResult = { reconciled: [], failed: [] };
    for (const aggregateProjectId of aggregateProjectIds) {
      try {
        outcome.reconciled.push({
          aggregateProjectId,
          result: await this.reconcile({ aggregateProjectId }),
        });
      } catch (error) {
        const failure = toError(error);
        logger.error(
          { organizationId, aggregateProjectId, error: failure },
          "failed to reconcile an aggregate project; continuing with the rest of the organisation",
        );
        captureException(failure, {
          extra: { organizationId, aggregateProjectId },
        });
        outcome.failed.push({ aggregateProjectId, error: failure });
      }
    }
    return outcome;
  }

  /**
   * For a trigger whose own write must not fail on this one: a person joining
   * or moving department has already happened. Never throws; the aggregates'
   * nightly sweeps, which every reconcile and every boot puts back when one
   * is missing, are the retry.
   */
  async reconcileOrganizationOrLog({
    organizationId,
    trigger,
  }: {
    organizationId: string;
    trigger: AggregateReconcileTrigger;
  }): Promise<void> {
    try {
      await this.reconcileOrganization({ organizationId });
    } catch (error) {
      const failure = toError(error);
      logger.error(
        { organizationId, trigger, error: failure },
        "failed to reconcile the organisation's aggregate projects; each aggregate's nightly sweep retries",
      );
      captureException(failure, { extra: { organizationId, trigger } });
    }
  }

  /**
   * A new aggregate: its nightly sweep is scheduled, then its members are
   * attached. Each step fails alone: a sweep that could not be written is put
   * back by the reconcile right after it, by the next trigger or by the next
   * boot, and a reconcile that fails is retried by the sweep. Never throws:
   * the project row already exists, and failing the request would only
   * invite a second, duplicate aggregate.
   */
  async start({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<void> {
    try {
      await this.scheduleSweep({ aggregateProjectId });
    } catch (error) {
      const failure = toError(error);
      logger.error(
        { aggregateProjectId, trigger: "aggregate-created", error: failure },
        "failed to schedule a new aggregate project's nightly sweep; its first reconcile puts it back",
      );
      captureException(failure, { extra: { aggregateProjectId } });
    }
    try {
      await this.reconcile({ aggregateProjectId });
    } catch (error) {
      const failure = toError(error);
      logger.error(
        { aggregateProjectId, trigger: "aggregate-created", error: failure },
        "failed to reconcile a new aggregate project; its nightly sweep retries",
      );
      captureException(failure, { extra: { aggregateProjectId } });
    }
  }

  /**
   * Boot-time repair, on the pattern of the report schedules' (ADR-044): a
   * live aggregate with no sweep row at all, from before block E or from a
   * schedule write that failed, gets one. A row that exists, active or
   * paused by an operator, is left as it stands. Race-safe on every worker,
   * as the row's create is.
   */
  async scheduleMissingSweeps(): Promise<{ repaired: number }> {
    if (!this.deps.schedule) return { repaired: 0 };
    let repaired = 0;
    for (const aggregate of await this.deps.aggregates.findAllLiveAggregates()) {
      if (
        await this.ensureSweepScheduled({
          organizationId: aggregate.organizationId,
          aggregateProjectId: aggregate.id,
        })
      ) {
        repaired++;
      }
    }
    return { repaired };
  }

  /**
   * Writes the aggregate's sweep row when it has none, and reports whether it
   * did. Create-if-missing rather than an upsert: the upsert re-arms a row an
   * operator paused and clears the slot the scheduler is firing, and the
   * sweep's own reconcile runs inside that fire. Never throws: the members
   * matter more than tonight's catch-up, which the next run puts back.
   */
  private async ensureSweepScheduled({
    organizationId,
    aggregateProjectId,
  }: {
    organizationId: string;
    aggregateProjectId: string;
  }): Promise<boolean> {
    if (!this.deps.schedule) return false;
    try {
      const rows = await this.deps.schedule.findAllForProject({
        projectId: aggregateProjectId,
        targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
      });
      if (rows.some((row) => row.targetId === aggregateProjectId)) return false;
      await this.scheduleSweep({ aggregateProjectId });
      logger.info(
        { organizationId, aggregateProjectId },
        "put back an aggregate project's missing nightly sweep",
      );
      return true;
    } catch (error) {
      const failure = toError(error);
      logger.error(
        { organizationId, aggregateProjectId, error: failure },
        "failed to put back an aggregate project's nightly sweep; the next reconcile tries again",
      );
      captureException(failure, {
        extra: { organizationId, aggregateProjectId },
      });
      return false;
    }
  }

  /** Writes (or re-arms) the aggregate's nightly sweep row. */
  async scheduleSweep({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<void> {
    if (!this.deps.schedule) return;
    await this.deps.schedule.upsertForTarget({
      projectId: aggregateProjectId,
      targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
      targetId: aggregateProjectId,
      cron: AGGREGATE_RECONCILE_SWEEP.cron,
      timezone: AGGREGATE_RECONCILE_SWEEP.timezone,
      nextRunAt: computeNextRunAt({
        cron: AGGREGATE_RECONCILE_SWEEP.cron,
        timezone: AGGREGATE_RECONCILE_SWEEP.timezone,
        after: this.now(),
      }),
    });
  }

  /**
   * An archived aggregate reads nothing: its nightly sweep is switched off
   * and every shared read it holds is revoked, marked rather than deleted.
   * Under the aggregate's lock, so a reconcile already running cannot attach
   * behind it. Returns the grant ids revoked.
   */
  async retire({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<string[]> {
    return this.deps.lock.withAggregateLock(
      { aggregateProjectId },
      async () => {
        await this.unscheduleSweep({ aggregateProjectId });
        const aggregate = await this.deps.aggregates.findAggregate({
          aggregateProjectId,
        });
        if (!aggregate) return [];
        const revoked = await this.deps.ledger().revokeSharedProjectGrants({
          organizationId: aggregate.organizationId,
          readerProjectId: aggregateProjectId,
          actor: ACTOR,
          reason: AGGREGATE_ARCHIVED,
        });
        logger.info(
          {
            organizationId: aggregate.organizationId,
            aggregateProjectId,
            revoked: revoked.length,
          },
          "retired an archived aggregate project's shared reads",
        );
        return revoked;
      },
    );
  }

  /** Switches the aggregate's nightly sweep off, as an archived one reads nothing. */
  async unscheduleSweep({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<void> {
    if (!this.deps.schedule) return;
    await this.deps.schedule.deactivateForTarget({
      projectId: aggregateProjectId,
      targetType: AGGREGATE_RECONCILE_SWEEP.targetType,
      targetId: aggregateProjectId,
    });
  }
}

/**
 * The scheduler handler for {@link AGGREGATE_RECONCILE_SWEEP}: the job's
 * target is the aggregate itself. A throw hands the slot back to the
 * scheduler's retry ladder.
 */
export function aggregateReconcileSweepHandler(
  reconciler: Pick<AggregateReconciler, "reconcile">,
): SchedulerHandler {
  return async (fire) => {
    await reconciler.reconcile({ aggregateProjectId: fire.targetId });
  };
}
