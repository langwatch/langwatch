import type { ProcessRef, ProcessStore } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type {
  AggregateProcessManager,
  AggregateProcessManagerInstance,
  AggregateProcessManagerOutboxMessage,
  ProcessFleetSummary,
  ProcessInstanceDetail,
} from "@langwatch/ops-contract";
import type { ProcessAuditEntryView } from "@langwatch/ops-contract";
import type { ProcessAuditSink } from "../repositories/prisma/prisma.process-audit.repository";
import type {
  DeadLetterCount,
  DeadOutboxMessageView,
  OutboxAttemptView,
  ProcessInstanceRow,
  ProcessOutboxMessageView,
  ProcessWakeRow,
} from "@langwatch/ops-contract";
import type { ProcessOpsRepository } from "../ports/process-ops.repository";
import type { OpsEventingIntrospectionPort } from "../ports/eventing-introspection.port";

/**
 * One global knob each, per the visibility plan: a wake this far past due
 * means the wake worker is starved or dead, and a pending message this far
 * past its next attempt with no live lease means delivery is not happening.
 * The table shows raw ages either way, so the thresholds only decide what
 * counts as trouble in the summary.
 */
export const OVERDUE_WAKE_MS = 60 * 1000;
export const OVERDUE_PENDING_MS = 5 * 60 * 1000;

/**
 * Reads the process-manager state machines for a single aggregate: the machine
 * definition (from the live pipeline introspection) joined to this aggregate's
 * persisted instance and the intents it has emitted.
 *
 * The machine itself is implicit in `evolve` (no declared state set), so the
 * "state machine" shown is the definition surface plus the instance's current
 * position — its state JSON, revision, and next wake.
 */
const logger = createLogger("langwatch:ops:manager-explorer");

export class ManagerExplorerService {
  private readonly store: ProcessStore;
  private readonly fleet: ProcessOpsRepository;
  private readonly audit: ProcessAuditSink;
  /** The live pipeline surface, supplied by the process composition. */
  private readonly introspection: OpsEventingIntrospectionPort;

  constructor(params: {
    store: ProcessStore;
    fleet: ProcessOpsRepository;
    audit: ProcessAuditSink;
    introspection: OpsEventingIntrospectionPort;
  }) {
    this.store = params.store;
    this.fleet = params.fleet;
    this.audit = params.audit;
    this.introspection = params.introspection;
  }

  /**
   * The fleet, one row per process name: registry identity merged with live
   * trouble counts. Registry-driven, so a process with no rows yet still
   * appears — a missing row and a healthy row must not look identical.
   */
  async getFleetSummary(): Promise<ProcessFleetSummary[]> {
    const counts = await this.fleet.countByProcessName({
      now: Date.now(),
      overdueWakeMs: OVERDUE_WAKE_MS,
      overduePendingMs: OVERDUE_PENDING_MS,
    });
    const byName = new Map(counts.map((c) => [c.processName, c]));
    const registry = this.introspection.processManagers();
    const registryNames = new Set(registry.map((m) => m.processName));

    const rows: ProcessFleetSummary[] = registry.map((m) => ({
      processName: m.processName,
      pipelineName: m.pipelineName,
      scheduled: m.scheduled,
      instances: byName.get(m.processName)?.instances ?? 0,
      overdueWakes: byName.get(m.processName)?.overdueWakes ?? 0,
      pendingMessages: byName.get(m.processName)?.pendingMessages ?? 0,
      overduePending: byName.get(m.processName)?.overduePending ?? 0,
      lapsedLeases: byName.get(m.processName)?.lapsedLeases ?? 0,
      deadMessages: byName.get(m.processName)?.deadMessages ?? 0,
    }));

    // Rows the tables hold but the registry does not: a renamed or retired
    // process whose instances outlived it. Real data, so it is shown rather
    // than orphaned invisibly; the pipeline column names the gap.
    for (const c of counts) {
      if (!registryNames.has(c.processName)) {
        rows.push({
          ...c,
          pipelineName: "(not registered)",
          scheduled: false,
        });
      }
    }

    const trouble = (r: ProcessFleetSummary) =>
      r.deadMessages * 4 + r.lapsedLeases * 3 + r.overduePending * 2 + r.overdueWakes;
    return rows.sort(
      (a, b) => trouble(b) - trouble(a) || a.processName.localeCompare(b.processName),
    );
  }

  async getInstances(params: {
    /** Omit to list instances across EVERY process manager. */
    processName?: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ instances: ProcessInstanceRow[]; total: number }> {
    return this.fleet.findInstances(params);
  }

  /** The soonest-due instance wakes across every process, for the dashboard. */
  async getUpcomingWakes(params: { limit: number }): Promise<ProcessWakeRow[]> {
    return this.fleet.findUpcomingWakes(params);
  }

  async getInstanceDetail(params: { ref: ProcessRef }): Promise<ProcessInstanceDetail | null> {
    const instance = await this.store.findByRef({ ref: params.ref });
    if (!instance) return null;
    return {
      ref: params.ref,
      tenantId: instance.tenantId,
      state: instance.state,
      revision: instance.revision,
      nextWakeAt: instance.nextWakeAt,
      updatedAt: instance.updatedAt,
    };
  }

  async getOutbox(params: {
    ref: ProcessRef;
    page: number;
    pageSize: number;
  }): Promise<{ messages: ProcessOutboxMessageView[]; total: number }> {
    return this.fleet.findOutboxMessages(params);
  }

  /**
   * Retired messages across the whole fleet.
   *
   * `getOutbox` needs a full process ref, so before this the only way to a
   * dead message was to already know which instance held it — and the fleet
   * table only ever reported a count. Work that has permanently stopped is
   * the most urgent thing this substrate can tell an operator, so it gets a
   * read that does not require knowing where to look.
   */
  async getDeadLetters(params: { processName?: string; page: number; pageSize: number }): Promise<{
    messages: DeadOutboxMessageView[];
    total: number;
    byProcess: DeadLetterCount[];
  }> {
    const [page, byProcess] = await Promise.all([
      this.fleet.findDeadMessages(params),
      this.fleet.countDeadByProcessName(),
    ]);
    return { ...page, byProcess };
  }

  /** The fleet's dead totals alone, for the badge and the dashboard card. */
  async getDeadLetterCounts(): Promise<DeadLetterCount[]> {
    return this.fleet.countDeadByProcessName();
  }

  /**
   * Set one instance's next wake to now. Safe by construction: `evolve`
   * receives `now` as data and clamps, so the worst case is a wake that
   * decides to do nothing.
   */
  async wakeNow(params: { ref: ProcessRef; actorUserId: string }): Promise<{ woke: boolean }> {
    const result = await this.fleet.wakeInstanceNow({
      ref: params.ref,
      now: Date.now(),
    });
    if (result.woke) {
      await this.audit.append({
        actorUserId: params.actorUserId,
        action: "process_wake_now",
        ...params.ref,
        metadata: { previousWakeAt: result.previousWakeAt },
      });
    }
    return { woke: result.woke };
  }

  /** All of one instance's dead messages back to pending, audited. */
  async redriveDeadInstance(params: {
    ref: ProcessRef;
    actorUserId: string;
  }): Promise<{ requeued: number }> {
    const requeued = await this.store.requeueDeadMessages({
      ...params.ref,
      now: Date.now(),
    });
    if (requeued > 0) {
      await this.audit.append({
        actorUserId: params.actorUserId,
        action: "process_redrive_dead_instance",
        ...params.ref,
        metadata: { requeued },
      });
    }
    return { requeued };
  }

  /** One dead message back to pending, audited. */
  async tryRedriveDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ redriven: boolean }> {
    const result = await this.fleet.tryRedriveDeadMessage({
      ref: params.ref,
      messageId: params.messageId,
      now: Date.now(),
    });
    if (!result) return { redriven: false };
    await this.audit.append({
      actorUserId: params.actorUserId,
      action: "process_redrive_dead_message",
      ...params.ref,
      metadata: { messageKey: result.messageKey },
    });
    return { redriven: true };
  }

  /**
   * One dead message marked never-to-be-sent, audited. A mark, not a
   * delete — the row stays as its own audit trail
   * (specs/ops/dead-letter-recovery.feature).
   */
  async tryDiscardDeadMessage(params: {
    ref: ProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ discarded: boolean }> {
    const result = await this.fleet.tryDiscardDeadMessage({
      ref: params.ref,
      messageId: params.messageId,
      now: Date.now(),
    });
    if (!result) return { discarded: false };
    await this.audit.append({
      actorUserId: params.actorUserId,
      action: "process_discard_dead_message",
      ...params.ref,
      metadata: { messageKey: result.messageKey },
    });
    return { discarded: true };
  }

  /**
   * Dead letters back to pending — one process name, or every process when
   * omitted. Bounded per call by the repository, so the returned count is
   * what moved rather than what existed; pressing again takes the next
   * batch. The count is the blast radius the audit row records.
   */
  async redriveDeadLetters(params: {
    processName?: string;
    actorUserId: string;
  }): Promise<{ redriven: number }> {
    const redriven = await this.fleet.redriveAllDeadMessages({
      ...(params.processName ? { processName: params.processName } : {}),
      now: Date.now(),
    });
    if (redriven > 0) {
      await this.audit.append({
        actorUserId: params.actorUserId,
        action: "process_redrive_dead_letters",
        // No single process, and no single project: the scope this act ran
        // under is the metadata, not a placeholder in the identity columns.
        processName: params.processName ?? null,
        projectId: null,
        processKey: null,
        metadata: { redriven, scope: params.processName ?? "every process" },
      });
    }
    return { redriven };
  }

  /** Dead letters marked discarded; same scoping and bound, audited with count. */
  async discardDeadLetters(params: {
    processName?: string;
    actorUserId: string;
  }): Promise<{ discarded: number }> {
    const discarded = await this.fleet.discardAllDeadMessages({
      ...(params.processName ? { processName: params.processName } : {}),
      now: Date.now(),
    });
    if (discarded > 0) {
      await this.audit.append({
        actorUserId: params.actorUserId,
        action: "process_discard_dead_letters",
        processName: params.processName ?? null,
        projectId: null,
        processKey: null,
        metadata: { discarded, scope: params.processName ?? "every process" },
      });
    }
    return { discarded };
  }

  /** The message's failed attempts, oldest first — why a dead letter died. */
  async getOutboxAttempts(params: {
    outboxId: string;
    projectId: string;
  }): Promise<OutboxAttemptView[]> {
    return this.fleet.findAttempts(params);
  }

  /**
   * Clear a LAPSED lease so the message is due now instead of waiting out
   * the lease window. The repository's write guards on the lapse, so a live
   * delivery keeps its lease; the residual risk — the holder is alive and
   * slow, and completion after this release re-delivers — is absorbed by the
   * message-key idempotency and stated in the confirm copy.
   */
  async tryReleaseLapsedLease(params: {
    ref: ProcessRef;
    messageId: string;
    actorUserId: string;
  }): Promise<{ released: boolean }> {
    const result = await this.fleet.tryReleaseLapsedLease({
      ref: params.ref,
      messageId: params.messageId,
      now: Date.now(),
    });
    if (!result) return { released: false };
    await this.audit.append({
      actorUserId: params.actorUserId,
      action: "process_release_lapsed_lease",
      ...params.ref,
      metadata: { messageKey: result.messageKey },
    });
    return { released: true };
  }

  /** Recent process control actions, so the page explains its own history. */
  async listRecentActions(params: { limit: number }): Promise<ProcessAuditEntryView[]> {
    return this.audit.listRecent(params);
  }

  /**
   * The per-aggregate managers for one aggregate. Scheduled singletons are
   * excluded — they are keyed by process name, not aggregate id, so "this
   * aggregate's instance" does not apply to them.
   */
  async getForAggregate(params: {
    aggregateType: string;
    projectId: string;
    aggregateId: string;
  }): Promise<AggregateProcessManager[]> {
    const managers = this.introspection
      .processManagers()
      .filter((m) => m.aggregateType === params.aggregateType && !m.scheduled);

    return Promise.all(
      managers.map(async (m) => {
        const ref: ProcessRef = {
          processName: m.processName,
          projectId: params.projectId,
          processKey: params.aggregateId,
        };
        const [instance, messages] = await Promise.all([
          this.store.findByRef({ ref }),
          this.store.findMessagesByRef({ ref }),
        ]);
        return {
          processName: m.processName,
          pipelineName: m.pipelineName,
          eventTypes: m.eventTypes,
          intentTypes: m.intentTypes,
          hasWake: m.hasWake,
          instance: instance
            ? {
                state: instance.state,
                revision: instance.revision,
                nextWakeAt: instance.nextWakeAt,
                updatedAt: instance.updatedAt,
              }
            : null,
          outbox: messages.map((msg) => ({
            messageKey: msg.messageKey,
            intentType: msg.intentType,
            status: msg.status,
            attempts: msg.attempts,
            nextAttemptAt: msg.nextAttemptAt,
            createdAt: msg.createdAt,
            sourceEventId: msg.sourceEventId,
          })),
        };
      }),
    );
  }

  /**
   * Dead-letter recovery for one process instance's outbox: dead rows go
   * back to pending with a fresh attempt budget, due immediately. Narrow
   * with `messageKeyPrefix` to requeue one target's messages (e.g. a single
   * webhook endpoint's batches) without resurrecting unrelated failures.
   */
  async requeueDeadMessages(params: {
    processName: string;
    projectId: string;
    processKey: string;
    messageKeyPrefix?: string;
    /** Actor id for the audit trail; the operation re-emits customer-bound
     *  deliveries, so who pressed the button matters. */
    requestedBy: string;
  }): Promise<{ requeued: number }> {
    const { requestedBy, ...rest } = params;
    const requeued = await this.store.requeueDeadMessages({
      ...rest,
      now: Date.now(),
    });
    // Intentionally retain these opaque operational IDs for the audit trail.
    logger.info({ ...rest, requestedBy, requeued }, "ops requeue of dead outbox messages");
    return { requeued };
  }
}
