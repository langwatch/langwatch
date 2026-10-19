import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildProcessManager } from "../../pipeline/processBuilder.ts";
import { ProcessStateUnreadableError } from "../failureDiagnostic.ts";
import { buildProcessDefinition } from "../processRuntime.ts";
import type { DueWake } from "../stores/processStore.types.ts";
import { ProcessWakeWorker } from "../wake/processWakeWorker.ts";

const sweep = buildProcessManager({
  name: "sweep",
  applier: (pm) =>
    pm
      .state(z.object({ lastSweepAt: z.number().nullable() }), { lastSweepAt: null })
      .schedule({ everyMs: 60_000 })
      .onWake((state) => ({ state }))
      .intent("noop", z.object({}), async () => {}),
});

function dueWake(processKey: string): DueWake {
  return {
    ref: { processName: "sweep", projectId: "project-1", processKey },
    revision: 1,
    wakeAt: 1,
  };
}

describe("a stored process state its schema no longer reads", () => {
  describe("when the process evolves over it", () => {
    it("refuses with the process, the instance and the issue paths, never the value", () => {
      const definition = buildProcessDefinition(sweep.config);

      const refusal = (() => {
        try {
          definition.evolve({
            previousState: { lastSweepAt: "yesterday" },
            input: { kind: "wake", scheduledFor: 1, now: 2 },
            ref: { processName: "sweep", projectId: "project-1", processKey: "key-1" },
          });
        } catch (error) {
          return error;
        }
      })();

      expect(refusal).toBeInstanceOf(ProcessStateUnreadableError);
      expect(refusal).toMatchObject({
        processName: "sweep",
        processKey: "key-1",
        issuePaths: ["lastSweepAt"],
      });
      expect(String(refusal)).not.toContain("yesterday");
    });
  });

  describe("when the wake worker meets it in a batch", () => {
    it("logs the instance and issue paths and goes on to the next wake", async () => {
      const { logger, lines } = createTestLogger();
      const handleWake = vi
        .fn()
        .mockRejectedValueOnce(
          new ProcessStateUnreadableError({
            processName: "sweep",
            processKey: "key-1",
            issuePaths: ["lastSweepAt"],
          }),
        )
        .mockResolvedValue({ outcome: "staleWake" });
      const worker = new ProcessWakeWorker({
        store: { findDueWakes: vi.fn().mockResolvedValue([dueWake("key-1"), dueWake("key-2")]) },
        managers: { sweep: { handleWake } },
        logger,
        now: () => 10,
      });

      worker.start();
      await vi.waitFor(() => expect(handleWake).toHaveBeenCalledTimes(2));
      await worker.stop();

      expect(lines.find((line) => line.level === 40)).toMatchObject({
        processName: "sweep",
        processKey: "key-1",
        issuePaths: ["lastSweepAt"],
      });
    });
  });
});
