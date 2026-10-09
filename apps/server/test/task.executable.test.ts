import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({
  configureLogger: vi.fn(),
  shutdown: vi.fn(async () => {}),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  configureLogger: observability.configureLogger,
}));

vi.mock(import("@langwatch/observability/node"), async (importOriginal) => ({
  ...(await importOriginal()),
  createProcessObservability: vi.fn(() => ({
    logger: observability.logger,
    shutdown: observability.shutdown,
  })),
}));

import {
  LocalTaskExecutable,
  LocalTaskExecutor,
  resolveLocalTaskExecutableConfig,
  runLocalTaskEntrypoint,
  type LocalTaskExecution,
} from "../src/task/task.executable.ts";

const taskSource = { NODE_ENV: "test" };

class RecordingExecutor extends LocalTaskExecutor {
  readonly executions: LocalTaskExecution[] = [];

  async execute(input: LocalTaskExecution): Promise<void> {
    this.executions.push(input);
  }
}

class FailingExecutor extends LocalTaskExecutor {
  async execute(): Promise<void> {
    throw new Error("task failed");
  }
}

describe("local task executable", () => {
  beforeEach(() => {
    observability.configureLogger.mockClear();
    observability.shutdown.mockReset();
    observability.shutdown.mockResolvedValue(undefined);
    observability.logger.error.mockClear();
    observability.logger.info.mockClear();
    observability.logger.warn.mockClear();
  });

  it("maps the telemetry slice, honouring old names and warning once per old name", () => {
    const config = resolveLocalTaskExecutableConfig({
      ENVIRONMENT: "staging",
      OTEL_SERVICE_NAME: "custom-task",
      _LOG_LEVEL: "warn",
      LOG_CONSOLE_LEVEL: "error",
    });

    expect(config).toMatchObject({
      serviceName: "custom-task",
      environment: "staging",
      logger: { level: "warn", consoleLevel: "error", deploymentEnvironment: "staging" },
    });
    expect(config.deprecations).toHaveLength(1);
  });

  it("falls back to the task service name and the local environment", () => {
    expect(resolveLocalTaskExecutableConfig(taskSource)).toMatchObject({
      serviceName: "langwatch:task",
      environment: "local",
      deprecations: [],
    });
  });

  it("passes the resolved task and argv tail to the injected registry executor", async () => {
    const executor = new RecordingExecutor();

    await LocalTaskExecutable.run({
      source: taskSource,
      args: ["backfill", "--dry-run", "tenant-a"],
      executor,
    });

    expect(executor.executions).toEqual([
      { taskName: "backfill", args: ["--dry-run", "tenant-a"] },
    ]);
    expect(observability.shutdown).toHaveBeenCalledOnce();
    expect(observability.logger.info).toHaveBeenLastCalledWith("done");
  });

  it("reports task errors through the executable host after flushing", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];

    await runLocalTaskEntrypoint({
      source: taskSource,
      executor: new FailingExecutor(),
      host: {
        argv: ["node", "task.ts", "failing"],
        exit: (code) => exits.push(code),
        writeStderr: (message) => stderr.push(message),
      },
    });

    expect(observability.shutdown).toHaveBeenCalledOnce();
    expect(exits).toEqual([1]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("[langwatch:task] fatal task failure: Error: task failed");
  });

  it("keeps a successful task successful when observability flushing fails", async () => {
    observability.shutdown.mockRejectedValueOnce(new Error("flush failed"));
    const executor = new RecordingExecutor();

    await expect(
      LocalTaskExecutable.run({ source: taskSource, args: ["backfill"], executor }),
    ).resolves.toBeUndefined();

    expect(observability.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error), taskName: "backfill" }),
      "failed to flush task observability",
    );
  });
});
