/**
 * Starts a scenario run on the Go runner (services/scenariorunner): the same environment, stdin
 * job and result line as the Node child, so the run reads the same either way.
 * @see specs/scenarios/go-scenario-runner-choice.feature
 */

import { spawn } from "node:child_process";
import path from "node:path";

import { createLogger } from "@langwatch/observability";

import type {
  ScenarioChildEnvironment,
  ScenarioChildExecutionSession,
} from "../app/scenario.app.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";
import type { ScenarioChildRunPool, ScenarioGoChildChannel } from "./scenario-child.channel.ts";
import {
  buildChildEnvironment,
  type ScenarioChildProcessConfig,
} from "./scenario-child.node.channel.ts";
import { superviseScenarioChild } from "./scenario-child.supervisor.channel.ts";

const logger = createLogger("langwatch:scenarios:go-child-process");

export class GoScenarioChildChannel implements ScenarioGoChildChannel {
  static create(options: {
    config: ScenarioChildProcessConfig;
    binaryPath: string | undefined;
  }): GoScenarioChildChannel {
    return new GoScenarioChildChannel(options);
  }

  private constructor(
    private readonly options: {
      config: ScenarioChildProcessConfig;
      binaryPath: string | undefined;
    },
  ) {
    this.binaryPath = options.binaryPath;
  }

  readonly binaryPath: string | undefined;

  start = async (input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
    pool: ScenarioChildRunPool;
  }): Promise<ScenarioChildExecutionSession> => {
    const { binaryPath } = this;
    if (binaryPath === undefined || input.jobData.target.type === "voice") {
      throw new Error("The Go scenario runner was started without a binary or for a voice run");
    }
    const childLogger = logger.child({
      scenarioId: input.jobData.scenarioId,
      projectId: input.jobData.projectId,
      batchRunId: input.jobData.batchRunId,
      setId: input.jobData.setId,
      scenarioRunId: input.jobData.scenarioRunId,
      component: "go-child-process",
    });
    const log = (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => childLogger[level](extra ?? {}, message);

    const child = spawn(binaryPath, [], {
      env: buildChildEnvironment({
        config: this.options.config,
        jobData: input.jobData,
        labels: input.environment.labels,
        telemetry: input.environment.telemetry,
      }),
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(binaryPath),
    });
    log("info", "Go scenario runner spawned", { pid: child.pid });

    return superviseScenarioChild({ child, jobData: input.jobData, pool: input.pool, log });
  };
}
