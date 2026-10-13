/**
 * How the workbench page's own execute stream reads back as a run: the harness and
 * the live scenario both grade a run from these frames.
 */
import { describe, expect, it } from "vitest";

import { runFromStream } from "./workbench-page-runs";

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

describe("runFromStream", () => {
  describe("given a stream that started, scored a row and finished", () => {
    it("names the run, keeps every event in order and reports success", () => {
      const run = runFromStream(
        frame({ type: "execution_started", runId: "run_1", total: 1 }) +
          ": keepalive\n\n" +
          frame({ type: "evaluator_result", rowIndex: 0, evaluatorId: "e1", result: {} }) +
          frame({ type: "done" }),
      );

      expect(run.runId).toBe("run_1");
      expect(run.events.map((event) => event.type)).toEqual([
        "execution_started",
        "evaluator_result",
        "done",
      ]);
      expect(run.status).toBe("success");
      expect(run.failure).toBeUndefined();
    });
  });

  describe("given a run-level error frame", () => {
    it("reports the run failed with the frame's message", () => {
      const run = runFromStream(frame({ type: "error", message: "no dataset" }));

      expect(run.status).toBe("error");
      expect(run.failure).toBe("no dataset");
    });
  });

  describe("given a row-level error followed by the end of the run", () => {
    it("keeps the run a success", () => {
      const run = runFromStream(
        frame({ type: "error", rowIndex: 2, message: "row failed" }) + frame({ type: "done" }),
      );

      expect(run.status).toBe("success");
    });
  });

  describe("given a stream that closed without a terminal frame", () => {
    it("reports the run failed and says why", () => {
      const run = runFromStream(frame({ type: "execution_started", runId: "run_2", total: 1 }));

      expect(run.status).toBe("error");
      expect(run.failure).toBe("the run's stream closed without a terminal frame");
    });
  });
});
