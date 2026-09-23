/**
 * Asking a run to stop: the durable command first, then the hint. A hint that
 * landed while the command was refused would stop the page with no record that
 * anyone asked. @see specs/instant-evals/instant-eval-api.feature
 */

import {
  InstantEvalAlreadyFinishedError,
  isInstantEvalRunActive,
} from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";

import type { InstantEvalCancellationChannel } from "../channels/instant-eval-cancellation.channel.ts";
import type { InstantEvalRunRow } from "../repositories/instant-eval-run.repository.ts";
import {
  isInstantEvalStoredStatus,
  publishedInstantEvalStatus,
} from "../rules/instant-eval-run-status.rules.ts";
import type { InstantEvalReadsService } from "./instant-eval-reads.service.ts";

const logger = createLogger("langwatch:instant-eval:cancel");

/**
 * Whether a run is still going, read through its published spelling so one
 * answer serves the client's poll and this refusal. A status the table never
 * wrote is treated as settled: there is no run left to stop.
 */
function isStillRunning(stored: string): boolean {
  return (
    isInstantEvalStoredStatus(stored) && isInstantEvalRunActive(publishedInstantEvalStatus(stored))
  );
}

/** The command a cancellation sends. The api role sends, never hosts. */
export interface InstantEvalCancelCommands {
  requestCancel(command: {
    tenantId: string;
    occurredAt: number;
    runId: string;
    requestedByUserId: string | null;
  }): Promise<unknown>;
}

export class InstantEvalCancelService {
  private readonly reads: InstantEvalReadsService;
  private readonly commands: InstantEvalCancelCommands;
  private readonly cancellations: InstantEvalCancellationChannel;
  private readonly now: () => number;

  private constructor(options: {
    reads: InstantEvalReadsService;
    commands: InstantEvalCancelCommands;
    cancellations: InstantEvalCancellationChannel;
    now: () => number;
  }) {
    this.reads = options.reads;
    this.commands = options.commands;
    this.cancellations = options.cancellations;
    this.now = options.now;
  }

  static create({
    reads,
    commands,
    cancellations,
    now,
  }: {
    reads: InstantEvalReadsService;
    commands: InstantEvalCancelCommands;
    cancellations: InstantEvalCancellationChannel;
    now: () => number;
  }): InstantEvalCancelService {
    return new InstantEvalCancelService({ reads, commands, cancellations, now });
  }

  async cancelRun({
    projectId,
    runId,
    requestedByUserId,
  }: {
    projectId: string;
    runId: string;
    requestedByUserId?: string;
  }): Promise<InstantEvalRunRow> {
    const row = await this.reads.getRun({ projectId, runId });
    if (!isStillRunning(row.status)) {
      throw new InstantEvalAlreadyFinishedError({ runId, status: row.status });
    }

    await this.commands.requestCancel({
      tenantId: projectId,
      occurredAt: this.now(),
      runId,
      requestedByUserId: requestedByUserId ?? null,
    });
    await this.cancellations.request({ runId });
    logger.info({ projectId, runId }, "Instant Eval run cancellation requested");

    return row;
  }
}
