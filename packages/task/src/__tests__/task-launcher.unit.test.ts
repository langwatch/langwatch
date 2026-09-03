import type { Logger } from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";
import { runTask } from "../task-launcher";
import { Task } from "../task";
import { TaskCatalogue } from "../task-catalogue";
import { TaskHostPort } from "../task-host.port";
import { TaskInfrastructureUnavailableError } from "../task.errors";

/** A minimal fake — the launcher only ever calls `.info` and `.error`. */
function silentLogger(): Logger & {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), error: vi.fn() } as unknown as Logger & {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

class RecordingTask extends Task {
  readonly name = "webhook-signature-vectors";
  readonly description = "records the args it was called with";
  receivedArgs: readonly string[] | undefined;

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    this.receivedArgs = args;
  }
}

class ThrowingTask extends Task {
  readonly name = "explodes";
  readonly description = "always throws";
  async run(): Promise<void> {
    throw new Error("boom");
  }
}

describe("runTask", () => {
  describe("given a catalogue that registers a task named webhook-signature-vectors", () => {
    /** @scenario "A task runs by name with its arguments" */
    it("runs the named task with its arguments and reports success", async () => {
      const task = new RecordingTask();
      const catalogue = TaskCatalogue.create({ tasks: [task] });
      const close = vi.fn().mockResolvedValue(undefined);
      const logger = silentLogger();

      const code = await runTask({
        catalogue,
        argv: ["webhook-signature-vectors", "--dry-run"],
        close,
        logger,
      });

      expect(code).toBe(0);
      expect(task.receivedArgs).toEqual(["--dry-run"]);
      expect(logger.info).toHaveBeenCalledWith(
        { task: "webhook-signature-vectors" },
        "task starting",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ task: "webhook-signature-vectors" }),
        "task finished",
      );
      expect(close).toHaveBeenCalledOnce();
    });
  });

  describe("given a catalogue that registers one or more tasks", () => {
    /** @scenario "An unknown task name lists the available names and exits non-zero" */
    it("lists the available names and exits non-zero for an unknown name", async () => {
      const catalogue = TaskCatalogue.create({ tasks: [new RecordingTask()] });
      const close = vi.fn().mockResolvedValue(undefined);
      const logger = silentLogger();

      const code = await runTask({ catalogue, argv: ["nonexistent"], close, logger });

      expect(code).not.toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          task: "nonexistent",
          availableNames: ["webhook-signature-vectors"],
        }),
        expect.any(String),
      );
      expect(close).toHaveBeenCalledOnce();
    });

    it("lists the available names and exits non-zero when no name is given", async () => {
      const catalogue = TaskCatalogue.create({ tasks: [new RecordingTask()] });
      const close = vi.fn().mockResolvedValue(undefined);
      const logger = silentLogger();

      const code = await runTask({ catalogue, argv: [], close, logger });

      expect(code).not.toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        { availableNames: ["webhook-signature-vectors"] },
        expect.any(String),
      );
    });
  });

  describe("given a catalogue that registers a task whose run method throws", () => {
    /** @scenario "A task that throws exits non-zero with one logged failure line and closes the host" */
    it("logs exactly one failure line, exits non-zero, and still awaits close", async () => {
      const catalogue = TaskCatalogue.create({ tasks: [new ThrowingTask()] });
      const close = vi.fn().mockResolvedValue(undefined);
      const logger = silentLogger();

      const code = await runTask({ catalogue, argv: ["explodes"], close, logger });

      expect(code).not.toBe(0);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledOnce();
    });
  });
});

class NoClickhouseHost extends TaskHostPort<{ name: string }> {
  readonly prisma = undefined;
  readonly clickhouse = undefined;
  readonly redis = undefined;
  readonly objectStorage = undefined;
  readonly config = { name: "test" };
}

describe("TaskHostPort", () => {
  describe("given a TaskHostPort composed without a ClickHouse handle", () => {
    /** @scenario "A task whose infrastructure handle is absent refuses by name" */
    it("refuses requireClickhouse with a named, non-stack-trace HandledError", () => {
      const host = new NoClickhouseHost();
      try {
        host.requireClickhouse();
        expect.unreachable("expected TaskInfrastructureUnavailableError");
      } catch (error) {
        expect(error).toBeInstanceOf(TaskInfrastructureUnavailableError);
        expect((error as TaskInfrastructureUnavailableError).code).toBe(
          "task_infrastructure_unavailable",
        );
        expect((error as TaskInfrastructureUnavailableError).message).toContain("ClickHouse");
      }
    });
  });
});
