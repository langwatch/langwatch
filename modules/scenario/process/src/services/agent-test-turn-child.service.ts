/**
 * Runs one "test agent" turn in a fresh scenario child, spawned the way a simulation's child is,
 * so the agent's adapter never runs in the process that serves the request.
 * @see specs/agents/agent-test-run.feature
 */

import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";

import { createLogger } from "@langwatch/observability";
import {
  AgentTestTurnAnswerSchema,
  CHILD_PROCESS,
  type AgentTestTurnAnswer,
  type AgentTestTurnJob,
  type ScenarioLogContext,
} from "@langwatch/scenario-contract";

import type { AgentTestTurnChild, ScenarioChildEnvironment } from "../app/scenario.app.ts";
import { ChildProcessSpawnService } from "./child-process-spawn.service.ts";
import {
  NodeScenarioChildService,
  type ScenarioChildProcessConfig,
} from "./node-scenario-child.service.ts";

const logger = createLogger("langwatch:scenarios:agent-test-turn-child");

/** The answer line the child wrote last, or `unanswered` when it wrote none. */
function lastAnswer({
  stdout,
  unanswered,
}: {
  stdout: string;
  unanswered: AgentTestTurnAnswer;
}): AgentTestTurnAnswer {
  for (const line of stdout.split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const parsed = AgentTestTurnAnswerSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }
  return unanswered;
}

export class AgentTestTurnChildService implements AgentTestTurnChild {
  static create(options: { config: ScenarioChildProcessConfig }): AgentTestTurnChildService {
    return new AgentTestTurnChildService(options.config);
  }

  private constructor(private readonly config: ScenarioChildProcessConfig) {}

  run(input: {
    job: AgentTestTurnJob;
    environment: ScenarioChildEnvironment;
    logContext: ScenarioLogContext;
  }): Promise<AgentTestTurnAnswer> {
    const spawnConfig = ChildProcessSpawnService.create().resolve({
      packageRoot: this.config.packageRoot,
      nodeEnv: this.config.nodeEnv,
      sourcePath: this.config.sourcePath,
      sourceRoots: this.config.sourceRoots,
    });
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      env: NodeScenarioChildService.buildBaseEnvironment({
        config: this.config,
        labels: input.environment.labels,
        telemetry: input.environment.telemetry,
        logContext: input.logContext,
      }),
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.packageRoot,
    });

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const settle = (answer: AgentTestTurnAnswer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(backstop);
        resolve(answer);
      };
      // The child keeps the call deadline itself; this only reclaims a child that hangs.
      const backstop = setTimeout(() => {
        child.kill();
        settle({ success: false, error: "The agent test turn's child process timed out" });
      }, CHILD_PROCESS.TIMEOUT_MS);

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      child.on("error", (error) => {
        settle({ success: false, error: `Child process error: ${error.message}` });
      });
      child.on("close", (code) => {
        if (code !== 0) logger.warn({ exitCode: code, stderr }, "agent test turn child failed");
        settle(
          lastAnswer({
            stdout,
            unanswered: {
              success: false,
              error: `Child process exited with code ${code}: ${stderr}`,
            },
          }),
        );
      });
      child.stdin?.on("error", (error) => {
        logger.warn({ error: error.message }, "agent test turn child stdin error");
      });
      child.stdin?.end(JSON.stringify(input.job));
    });
  }
}
