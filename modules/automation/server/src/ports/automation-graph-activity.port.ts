import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  TriggerSummary,
} from "@langwatch/automation-contract";

/**
 * The two questions the real-time graph-alert path asks Automation.
 *
 * Trace's `graphTriggerActivity` subscriber runs on every trace that lands: it
 * asks which of a project's automations watch a custom graph, and then asks for
 * each of them to be re-evaluated. Those two calls are the ENTIRE dependency
 * that pipeline has on this feature — no writes, no schedules, no test fires,
 * no cap accounting.
 *
 * Narrowing them to a port is what breaks a cycle. The subscriber used to name
 * `AutomationService`, the whole capability, which drags report scheduling,
 * template test fires and the persist-cap ledger behind it; a process that
 * wanted only the two methods had to compose all of it or none. The published
 * `AutomationService` satisfies this port structurally, so the application
 * keeps passing exactly what it passed before, while a background process can
 * compose the graph half alone (`PostgresAutomationGraphActivityAdapter`).
 *
 * Deliberately NOT here: `decideGraphTriggerHeartbeat` and
 * `handlePersistCapBreach`. Both are graph-shaped and both look like they
 * belong, and neither is on this path — the heartbeat is the sweep process's
 * question and needs a ClickHouse recency read, containment is the persist
 * ledger's and needs a runaway notifier. Adding either would make every
 * implementer supply a collaborator the caller never reaches.
 */
export abstract class AutomationGraphActivityPort {
  /**
   * The project's active automations that watch a custom graph.
   *
   * Reports only, and never a REPORT-kind automation: a report is a schedule,
   * not an alert, and re-evaluating one on trace activity would fire it off
   * calendar.
   */
  abstract getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]>;

  /**
   * Re-evaluates one graph automation and dispatches an alert if it fired.
   *
   * Idempotent by its own open/resolve bookkeeping rather than by the caller's:
   * the subscriber's retry, the heartbeat sweep and a manual re-run all land
   * here, and the same incident must not notify twice.
   */
  abstract evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;
}

/**
 * The project read a graph alert is addressed with.
 *
 * A dispatched alert names the project it is about — its name in the subject
 * line, its slug in every link back to the deployment — and that is the entire
 * project question the graph path asks. Naming it here rather than taking a
 * whole `ProjectService` is the same narrowing this file already does for
 * Automation itself: the write graph behind `ProjectService` drags a
 * credentials port, an organization service and, through it, an authz service
 * into a process that only sends an alert. `ProjectService` and
 * `ProjectMetadataService` both satisfy this.
 */
export abstract class AutomationProjectIdentityPort {
  abstract tryGetById(projectId: string): Promise<{
    id: string;
    name: string;
    slug: string;
  } | null>;
}
