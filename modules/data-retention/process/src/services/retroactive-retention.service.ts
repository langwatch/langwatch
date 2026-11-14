import {
  RetroactiveMutationInProgressError,
  type RetentionCategory,
  type RetroactiveApplyRequestedData,
  type RetroactiveCancelRequestedData,
  type RetroactiveMutationProgress,
  type RetroactiveMutationRecord,
  type RetroactiveProgressRecordedData,
} from "@langwatch/data-retention-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import type {
  RetroactiveStatus,
  RetroactiveStatusRepository,
} from "../repositories/retroactive-status.repository.ts";
import {
  blockingProgressOf,
  foldRetroactiveStatus,
  isRetroactiveRequestOpen,
  issuedTargetsOf,
  namesUnstartedApply,
  progressChanged,
  progressOf,
  recordMutations,
  type RetroactiveFact,
  withIssuedTargets,
} from "../rules/retroactive-status.rules.ts";

const logger = createLogger("langwatch:data-retention:retroactive");

/** What each command sends: its event's data, plus the tenant and the moment. */
export type RetroactiveCommandPayload<Data> = Data & { tenantId: string; occurredAt: number };
type Sender<Data> = Readonly<{
  send: (payload: RetroactiveCommandPayload<Data>) => Promise<unknown>;
}>;

export type RetroactiveRetentionSenders = Readonly<{
  requestRetroactiveApply: Sender<RetroactiveApplyRequestedData>;
  requestRetroactiveCancel: Sender<RetroactiveCancelRequestedData>;
  recordRetroactiveProgress: Sender<RetroactiveProgressRecordedData>;
}>;

/**
 * Applying retention to stored rows (ADR-202 Decided 13): the api records requests and reads the
 * status; the worker runs the rewrites, records progress and folds every fact into the status.
 * Spec: modules/data-retention/specs/retroactive-retention-via-worker.feature
 */
export class RetroactiveRetentionService {
  static create(options: {
    retroactive: RetroactiveRetentionRepository;
    status: RetroactiveStatusRepository;
    /** The apply intent's last attempt: a failure there clears the applying state. */
    applyMaxAttempts: number;
  }): RetroactiveRetentionService {
    return new RetroactiveRetentionService(options);
  }

  #senders: RetroactiveRetentionSenders | undefined;

  private constructor(
    private readonly options: {
      retroactive: RetroactiveRetentionRepository;
      status: RetroactiveStatusRepository;
      applyMaxAttempts: number;
    },
  ) {}

  connect(senders: RetroactiveRetentionSenders): void {
    this.#senders = senders;
  }

  #sender<Name extends keyof RetroactiveRetentionSenders>(
    name: Name,
  ): RetroactiveRetentionSenders[Name] {
    const senders = this.#senders;
    if (!senders) throw new Error(`data_retention_retroactive is not registered: ${name}`);
    return senders[name];
  }

  /** Records the apply and answers the tables it targets; refuses while one of its kind is open. */
  async requestApply(input: {
    projectId: string;
    category: RetentionCategory;
    retentionDays: number;
    userId: string;
  }): Promise<{ tables: string[] }> {
    const status = await this.options.status.getForProject(input);
    const blocking = blockingProgressOf({ status, category: input.category });
    if (blocking.length > 0) throw new RetroactiveMutationInProgressError(blocking);

    await this.#sender("requestRetroactiveApply").send({
      tenantId: input.projectId,
      projectId: input.projectId,
      requestId: generate("retentionrequest").toString(),
      category: input.category,
      retentionDays: input.retentionDays,
      requestedByUserId: input.userId,
      occurredAt: nowInstant().epochMilliseconds,
    });
    return { tables: this.options.retroactive.plannedTables({ category: input.category }) };
  }

  async requestCancel(input: {
    projectId: string;
    mutationId: string;
    userId: string;
  }): Promise<void> {
    await this.#sender("requestRetroactiveCancel").send({
      tenantId: input.projectId,
      projectId: input.projectId,
      requestId: generate("retentionrequest").toString(),
      mutationId: input.mutationId,
      requestedByUserId: input.userId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  async getProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]> {
    return progressOf(await this.options.status.getForProject(input));
  }

  /** Worker: folds one of the pipeline's facts into the project's status row. */
  async fold(input: { projectId: string; fact: RetroactiveFact }): Promise<void> {
    const status = await this.options.status.getForProject(input);
    const next = foldRetroactiveStatus({ status, fact: input.fact });
    if (next !== null) await this.options.status.save(next);
  }

  /**
   * Worker: issues the apply's rewrites one by one, recording each, so a redelivery after a crash
   * issues only the rest. A first delivery finding one of its kind running settles as already
   * running. A failure is thrown for the outbox to retry; the last attempt records it first.
   */
  async runApply(
    apply: RetroactiveApplyRequestedData,
    context: { attempt: number },
  ): Promise<void> {
    const status = await this.options.status.getForProject(apply);
    if (!isRetroactiveRequestOpen({ status, requestId: apply.requestId })) return;

    try {
      const outcome = await this.#issueRewrites({ apply, status });
      await this.#recordProgress({
        projectId: apply.projectId,
        settled: { requestId: apply.requestId, outcome },
      });
    } catch (error) {
      if (context.attempt >= this.options.applyMaxAttempts) {
        logger.error(
          { projectId: apply.projectId, requestId: apply.requestId, error },
          "Retroactive retention rewrite gave up after its last attempt",
        );
        await this.#recordProgress({
          projectId: apply.projectId,
          settled: { requestId: apply.requestId, outcome: "failed" },
        });
      }
      throw error;
    }
  }

  async #issueRewrites({
    apply,
    status,
  }: {
    apply: RetroactiveApplyRequestedData;
    status: RetroactiveStatus;
  }): Promise<"started" | "already_running"> {
    const { projectId, requestId, category } = apply;
    const earlier = issuedTargetsOf({ status, requestId });
    if (earlier.kind === "not_started") {
      const running = await this.options.retroactive.findActiveMutations({ projectId, category });
      if (running.length > 0) return "already_running";
    }
    const issued = earlier.kind === "started" ? [...earlier.targets] : [];
    await this.#saveIssued({ projectId, requestId, targets: issued });
    for (const target of this.options.retroactive.applyTargets({ category })) {
      if (issued.includes(target)) continue;
      await this.options.retroactive.rewriteTarget({
        projectId,
        category,
        newRetentionDays: apply.retentionDays,
        target,
      });
      issued.push(target);
      await this.#saveIssued({ projectId, requestId, targets: issued });
    }
    return "started";
  }

  async #saveIssued(input: {
    projectId: string;
    requestId: string;
    targets: readonly string[];
  }): Promise<void> {
    const { issued } = await this.options.status.getForProject(input);
    await this.options.status.saveIssued({
      projectId: input.projectId,
      issued: withIssuedTargets({ issued, ...input }),
    });
  }

  /** Worker: kills the named rewrite; an apply never run was closed or dismissed by the fold. */
  async runCancel(cancel: RetroactiveCancelRequestedData): Promise<void> {
    if (namesUnstartedApply(cancel.mutationId)) return;
    await this.options.retroactive.killMutation({
      projectId: cancel.projectId,
      mutationId: cancel.mutationId,
    });
    await this.#recordProgress({ projectId: cancel.projectId, settled: null });
  }

  /** Worker: re-reads the project's running rewrites and records them when they moved. */
  async refreshProgress(input: { projectId: string }): Promise<void> {
    const status = await this.options.status.getForProject(input);
    const read = await this.options.retroactive.findMutationProgress(input);
    const mutations = recordMutations({ before: status.mutations, read });
    if (progressChanged({ before: status.mutations, after: mutations })) {
      await this.#send({ projectId: input.projectId, mutations, settled: null });
    }
  }

  async #recordProgress(input: {
    projectId: string;
    settled: RetroactiveProgressRecordedData["settled"];
  }): Promise<void> {
    const status = await this.options.status.getForProject(input);
    const read = await this.options.retroactive.findMutationProgress(input);
    await this.#send({ ...input, mutations: recordMutations({ before: status.mutations, read }) });
  }

  async #send(input: {
    projectId: string;
    mutations: RetroactiveMutationRecord[];
    settled: RetroactiveProgressRecordedData["settled"];
  }): Promise<void> {
    await this.#sender("recordRetroactiveProgress").send({
      tenantId: input.projectId,
      projectId: input.projectId,
      mutations: input.mutations,
      settled: input.settled,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }
}
