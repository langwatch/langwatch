/**
 * Stopping a run: the command is the record, the hint only saves a page.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryInstantEvalCancellationChannel } from "../../channels/memory/memory.instant-eval-cancellation.channel.ts";
import type {
  InstantEvalJudgmentPage,
  InstantEvalJudgmentsRepository,
} from "../../repositories/instant-eval-judgments.repository.ts";
import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import type { InstantEvalStoredStatus } from "../../rules/instant-eval-run-status.rules.ts";
import {
  InstantEvalCancelService,
  type InstantEvalCancelCommands,
} from "../instant-eval-cancel.service.ts";
import { InstantEvalReadsService } from "../instant-eval-reads.service.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00Z");

/** A judgements store no cancellation reads. */
class UnreadJudgments implements InstantEvalJudgmentsRepository {
  async countUsage(): Promise<number> {
    return 0;
  }

  async insert(): Promise<void> {
    // A cancellation writes no judgement.
  }

  async getPage(): Promise<InstantEvalJudgmentPage> {
    return { judgments: [] };
  }

  async findSample(): Promise<[]> {
    return [];
  }
}

/** A command sender that records what it was sent, or refuses to send at all. */
class RecordingCommands implements InstantEvalCancelCommands {
  readonly sent: { runId: string; requestedByUserId: string | null }[] = [];

  constructor(private readonly failure?: Error) {}

  async requestCancel(command: {
    runId: string;
    requestedByUserId: string | null;
  }): Promise<unknown> {
    if (this.failure) throw this.failure;
    this.sent.push({ runId: command.runId, requestedByUserId: command.requestedByUserId });
    return undefined;
  }
}

async function harness(options: { status?: InstantEvalStoredStatus; failure?: Error } = {}) {
  const runs = MemoryInstantEvalRunRepository.create(() => NOW);
  const row = await runs.create({
    id: "instanteval_1",
    projectId: "project-1",
    name: null,
    sql: "SELECT TraceId FROM analytics.traces",
    parameters: {},
    questions: [],
    plan: [],
    rowLimit: 10_000,
  });
  if (options.status) await runs.write({ ...row, status: options.status });
  const commands = new RecordingCommands(options.failure);
  const cancellations = MemoryInstantEvalCancellationChannel.create();

  return {
    runs,
    commands,
    cancellations,
    cancels: InstantEvalCancelService.create({
      reads: InstantEvalReadsService.create({
        runs,
        judgments: new UnreadJudgments(),
        now: () => NOW,
      }),
      commands,
      cancellations,
      now: () => NOW.epochMilliseconds,
    }),
  };
}

describe("given a run that is still going", () => {
  describe("when it is cancelled", () => {
    /** @scenario "A running run can be cancelled" */
    it("records the request and then hints the page in flight", async () => {
      const { cancels, commands, cancellations } = await harness({ status: "RUNNING" });

      const row = await cancels.cancelRun({
        projectId: "project-1",
        runId: "instanteval_1",
        requestedByUserId: "user-1",
      });

      expect(row.id).toBe("instanteval_1");
      expect(commands.sent).toEqual([{ runId: "instanteval_1", requestedByUserId: "user-1" }]);
      expect(await cancellations.isRequested({ runId: "instanteval_1" })).toBe(true);
    });

    it("leaves no hint behind when the request itself was refused", async () => {
      const { cancels, cancellations } = await harness({
        status: "RUNNING",
        failure: new Error("queue unreachable"),
      });

      await expect(
        cancels.cancelRun({ projectId: "project-1", runId: "instanteval_1" }),
      ).rejects.toThrow("queue unreachable");
      expect(await cancellations.isRequested({ runId: "instanteval_1" })).toBe(false);
    });
  });
});

describe("given a run that has already settled", () => {
  describe("when it is cancelled", () => {
    /** @scenario "A finished run cannot be cancelled" */
    it("is refused, naming the status it settled in", async () => {
      const { cancels, commands } = await harness({ status: "FINISHED" });

      await expect(
        cancels.cancelRun({ projectId: "project-1", runId: "instanteval_1" }),
      ).rejects.toMatchObject({
        code: "instant_eval_already_finished",
        meta: { runId: "instanteval_1", status: "finished" },
      });
      expect(commands.sent).toEqual([]);
    });
  });
});

describe("given an id no run of this project has", () => {
  describe("when it is cancelled", () => {
    /** @scenario "A run of another project is not found" */
    it("is not found rather than refused as finished", async () => {
      const { cancels } = await harness();

      await expect(
        cancels.cancelRun({ projectId: "project-2", runId: "instanteval_1" }),
      ).rejects.toMatchObject({ code: "instant_eval_not_found" });
    });
  });
});
