import type {
  AgentTestTurnAnswer,
  AgentTestTurnJob,
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "@langwatch/scenario-contract";

import type {
  AgentTestTurnChild,
  ScenarioChildEnvironment,
  ScenarioChildExecutionSession,
} from "../../app/scenario.app.ts";
import type { ExecutionJobData } from "../../services/scenario-execution-pool.service.ts";
import type { ScenarioGoChildChannel } from "../scenario-child.channel.ts";

/** Answers every run and agent-test turn in-process with what a test seeds; spawns nothing. */
export class MemoryScenarioChildChannel implements ScenarioGoChildChannel, AgentTestTurnChild {
  static create(
    options: {
      result?: ScenarioExecutionResult;
      answer?: AgentTestTurnAnswer;
      binaryPath?: string;
    } = {},
  ): MemoryScenarioChildChannel {
    return new MemoryScenarioChildChannel(options);
  }

  readonly started: ExecutionJobData[] = [];
  readonly executed: ChildProcessJobData[] = [];
  readonly turns: AgentTestTurnJob[] = [];
  readonly binaryPath: string | undefined;

  private constructor(
    private readonly options: {
      result?: ScenarioExecutionResult;
      answer?: AgentTestTurnAnswer;
      binaryPath?: string;
    },
  ) {
    this.binaryPath = options.binaryPath;
  }

  start = async (input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): Promise<ScenarioChildExecutionSession> => {
    this.started.push(input.jobData);
    const result = this.options.result ?? { success: true };
    return {
      execute: async (data) => {
        this.executed.push(data);
        return result;
      },
      abort: async () => {},
    };
  };

  async run(input: {
    job: AgentTestTurnJob;
    environment: ScenarioChildEnvironment;
  }): Promise<AgentTestTurnAnswer> {
    this.turns.push(input.job);
    return this.options.answer ?? { success: false, error: "No agent test turn was seeded" };
  }
}
