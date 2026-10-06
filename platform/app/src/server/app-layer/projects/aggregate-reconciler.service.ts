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
import type { AggregateProjectRepository } from "./repositories/aggregate-rule.repository";

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

/** What the reconciler needs of the grants ledger, and nothing more. */
export type SharedProjectGrantsLedger = Pick<
  GrantsLedgerWriter,
  | "findLiveSharedProjectGrants"
  | "attachSharedProjectGrant"
  | "revokeSharedProjectGrants"
>;

/** What the reconciler needs of the scheduler: one row per aggregate. */
export type AggregateSweepSchedule = Pick<
  ScheduledJobRepository,
  "upsertForTarget" | "deactivateForTarget"
>;

/** Member project ids, each in exactly one list. */
export type AggregateReconcileResult = {
  attached: string[];
  revoked: string[];
  unchanged: string[];
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
  | "nightly-sweep";

const NOTHING: AggregateReconcileResult = {
  attached: [],
  revoked: [],
  unchanged: [],
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
   */
  async reconcile({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<AggregateReconcileResult> {
    const aggregate = await this.deps.aggregates.findAggregate({
      aggregateProjectId,
    });
    if (!aggregate || aggregate.archived) return NOTHING;
    const { organizationId } = aggregate;
    if (!aggregate.rule) {
      logger.error(
        { organizationId, aggregateProjectId },
        "aggregate project has a stored rule that does not parse; reconciling nothing",
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
    const attached: string[] = [];
    const from = this.now().toISOString();
    for (const memberProjectId of [...desired].sort()) {
      if (held.has(memberProjectId)) continue;
      const outcome = await ledger.attachSharedProjectGrant({
        organizationId,
        readerProjectId: aggregateProjectId,
        memberProjectId,
        condition: { type: "trace", from },
        actor: ACTOR,
        source: "aggregate-reconciler",
      });
      // A concurrent run got there first; its row is the one that stands.
      (outcome.attached ? attached : unchanged).push(memberProjectId);
    }

    const result = { attached, revoked, unchanged: unchanged.sort() };
    logger.info(
      {
        organizationId,
        aggregateProjectId,
        ruleKind: aggregate.rule.kind,
        attached: result.attached.length,
        revoked: result.revoked.length,
        unchanged: result.unchanged.length,
      },
      "reconciled aggregate project members",
    );
    return result;
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
   * or moving department has already happened, and the nightly sweep is the
   * retry. Never throws.
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
        "failed to reconcile the organisation's aggregate projects; the nightly sweep retries",
      );
      captureException(failure, { extra: { organizationId, trigger } });
    }
  }

  /**
   * A new aggregate: its nightly sweep is scheduled first, so a reconcile
   * that fails here is still caught tonight, then its members are attached.
   * Never throws: the project row already exists, and failing the request
   * would only invite a second, duplicate aggregate.
   */
  async start({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<void> {
    try {
      await this.scheduleSweep({ aggregateProjectId });
      await this.reconcile({ aggregateProjectId });
    } catch (error) {
      const failure = toError(error);
      logger.error(
        { aggregateProjectId, trigger: "aggregate-created", error: failure },
        "failed to start a new aggregate project's reconciliation; the nightly sweep retries",
      );
      captureException(failure, { extra: { aggregateProjectId } });
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
