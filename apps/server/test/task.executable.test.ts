import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({
  configureLogger: vi.fn(),
  shutdown: vi.fn(async () => {}),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@langwatch/observability", () => ({
  configureLogger: observability.configureLogger,
}));

vi.mock("@langwatch/observability/node", () => ({
  createProcessObservability: vi.fn(() => ({
    logger: observability.logger,
    shutdown: observability.shutdown,
  })),
}));

import {
  LocalTaskExecutable,
  LocalTaskExecutorPort,
  resolveLocalTaskExecutableConfig,
  runLocalTaskEntrypoint,
  type LocalTaskExecution,
} from "../src/task/task.executable.ts";

const taskSource = { NODE_ENV: "test" };

class RecordingExecutor extends LocalTaskExecutorPort {
  readonly executions: LocalTaskExecution[] = [];

  async execute(input: LocalTaskExecution): Promise<void> {
    this.executions.push(input);
  }
}

class FailingExecutor extends LocalTaskExecutorPort {
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
  });

  it("preserves legacy logger aliases in its typed process projection", () => {
    expect(
      resolveLocalTaskExecutableConfig({
        NODE_ENV: "production",
        ENVIRONMENT: "staging",
        OTEL_SERVICE_NAME: " custom-task ",
        _LOG_LEVEL: "warn",
        PINO_CONSOLE_LEVEL: "error",
        PINO_OTEL_ENABLED: "true",
        PINO_OTEL_LEVEL: "debug",
        OTEL_RESOURCE_ATTRIBUTES: "service.version=1.2%2E3",
        npm_package_version: "not-used-for-service-version",
      }),
    ).toEqual({
      serviceName: "custom-task",
      environment: "staging",
      logger: {
        environment: "production",
        format: undefined,
        level: "warn",
        consoleLevel: "error",
        otelLevel: "debug",
        otelExportEnabled: true,
        serviceName: " custom-task ",
        serviceVersion: "1.2.3",
        deploymentEnvironment: "staging",
        otelTransportServiceVersion: "not-used-for-service-version",
      },
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
