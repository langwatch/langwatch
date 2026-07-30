import type { GroupKey } from "@langwatch/event-sourcing";

/**
 * Dispatch-plane keys for the `evaluation` aggregate (ADR-100).
 *
 * Every key is the typed `{tenantId, lane, scope}` descriptor rendered by
 * `@langwatch/event-sourcing`'s `renderGroupKey` — never a hand-concatenated
 * string. Both lanes here use `scope: "aggregate"`, the ADR-100 default,
 * because both the fold (which MUST be aggregate-scoped — ADR-106 decision
 * 2's `fold-scope-must-be-aggregate` rule) and the command lane (one
 * evaluation, applied in isolation) genuinely want one lane per evaluation.
 * Neither needs the old pipeline's `serializeByAggregate` re-key
 * (`pipeline.ts`'s `withCommandInstance(..., { serializeByAggregate: true })`)
 * — ADR-100 §4 removes that option outright; a command lane just declares
 * `scope: "aggregate"` directly.
 */

/** The aggregate id for an `evaluation` aggregate — extracted once, here,
 * rather than inlined at each call site (mirrors `logRecordAggregateId` in
 * `log-processing/aggregate.ts`, and the aggregate.types.ts/`defineAggregate`
 * builder itself does not offer an `.aggregateId()` step to do this for us —
 * see that module's docblock for the same observation). */
export function evaluationAggregateId(data: { evaluationId: string }): string {
  return data.evaluationId;
}

/** The `evaluationAnalytics` fold's lane: one lane per evaluation, required
 * by ADR-106. */
export function evaluationAnalyticsFoldGroupKey(args: {
  tenantId: string;
  evaluationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "fold", name: "evaluationAnalytics" },
    scope: {
      kind: "aggregate",
      aggregateType: "evaluation",
      aggregateId: args.evaluationId,
    },
  };
}

/**
 * The `report` command's lane. Named (`"report"`), not the serialised
 * aggregate-wide command lane the old pipeline used
 * (`ExecuteEvaluationCommand`'s dedup/delay options rode a `commandAll`-style
 * lane before ADR-100): under the new descriptor a command lane's `scope` is
 * what determines serialisation, and naming the lane lets `start` and
 * `report` run concurrently for the same evaluation when both are in flight
 * (the SDK's two-phase report path), rather than contending for one shared
 * lane the way `serializeByAggregate: true` used to force.
 */
export function evaluationReportCommandGroupKey(args: {
  tenantId: string;
  evaluationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "report" },
    scope: {
      kind: "aggregate",
      aggregateType: "evaluation",
      aggregateId: args.evaluationId,
    },
  };
}

/** The `start` command's lane — see {@link evaluationReportCommandGroupKey}. */
export function evaluationStartCommandGroupKey(args: {
  tenantId: string;
  evaluationId: string;
}): GroupKey {
  return {
    tenantId: args.tenantId,
    lane: { kind: "command", name: "start" },
    scope: {
      kind: "aggregate",
      aggregateType: "evaluation",
      aggregateId: args.evaluationId,
    },
  };
}
