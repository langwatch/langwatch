/**
 * Accepting a run writes the row before it sends the command, and fails the
 * row when the command never lands.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import { describe, expect, it } from "vitest";

import { MemoryInstantEvalRunRepository } from "../../repositories/memory/memory.instant-eval-run.repository.ts";
import {
  InstantEvalCreateService,
  type InstantEvalRunCommands,
} from "../instant-eval-create.service.ts";
import type { AcceptedInstantEvalStatement } from "../instant-eval-statement.service.ts";

const NOW = 1_758_000_000_000;

const ACCEPTED: AcceptedInstantEvalStatement = {
  sql: "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
  parameters: { since: "2026-09-01" },
  questions: [
    {
      id: "annoyed",
      function: "eval",
      kind: "boolean",
      reads: "probability",
      question: { id: "annoyed", kind: "boolean", instructions: "annoyed?" },
      threshold: 0.5,
    },
  ],
  plan: [{ column: "annoyed", function: "eval", options: ["annoyed?"] }],
  keyColumns: ["ThreadId"],
  columns: [{ name: "TraceId", type: "String" }],
};

/** A command sender that records what it was sent, or refuses to send at all. */
class RecordingCommands implements InstantEvalRunCommands {
  readonly sent: { runId: string; rowLimit: number }[] = [];

  constructor(private readonly failure?: Error) {}

  async requestRun(command: { runId: string; rowLimit: number }): Promise<unknown> {
    if (this.failure) throw this.failure;
    this.sent.push({ runId: command.runId, rowLimit: command.rowLimit });
    return undefined;
  }
}

function harness(failure?: Error) {
  const runs = MemoryInstantEvalRunRepository.create();
  const commands = new RecordingCommands(failure);

  return {
    runs,
    commands,
    creates: InstantEvalCreateService.create({ runs, commands, now: () => NOW }),
  };
}

describe("given a statement a run was accepted for", () => {
  describe("when the run is created", () => {
    it("writes the queued row and then sends the command", async () => {
      const { runs, commands, creates } = harness();

      const row = await creates.createRun({
        projectId: "project-1",
        name: "nightly",
        accepted: ACCEPTED,
        rowLimit: 10_000,
      });

      expect(row.status).toBe("QUEUED");
      expect(row.id).toMatch(/^instanteval_/);
      expect(commands.sent).toEqual([{ runId: row.id, rowLimit: 10_000 }]);
      expect(await runs.findById({ projectId: "project-1", runId: row.id })).toMatchObject({
        name: "nightly",
        sql: ACCEPTED.sql,
        parameters: ACCEPTED.parameters,
      });
    });
  });

  describe("when the command cannot be dispatched", () => {
    it("fails the row rather than leaving it queued forever", async () => {
      const { runs, creates } = harness(new Error("queue unreachable"));

      await expect(
        creates.createRun({
          projectId: "project-1",
          runId: "instanteval_fixed",
          name: null,
          accepted: ACCEPTED,
          rowLimit: 500,
        }),
      ).rejects.toThrow("queue unreachable");

      expect(
        await runs.findById({ projectId: "project-1", runId: "instanteval_fixed" }),
      ).toMatchObject({ status: "FAILED", error: "internal_error" });
    });
  });
});
