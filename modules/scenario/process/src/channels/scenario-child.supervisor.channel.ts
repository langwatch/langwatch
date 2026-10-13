/**
 * Supervises a spawned scenario child, Node or Go alike: registers it with the pool, writes the
 * job, enforces the timeout and reads the last result line it wrote.
 */

import type { ChildProcess } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";

import {
  CHILD_PROCESS,
  ScenarioAgentInstanceSchema,
  type ChildProcessJobData,
  type ScenarioExecutionResult,
} from "@langwatch/scenario-contract";
import { z } from "zod";

import type { ScenarioChildExecutionSession } from "../app/scenario.app.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";
import type { ScenarioChildRunPool } from "./scenario-child.channel.ts";

export type ChildLog = (
  level: "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => void;

type ScenarioChildProcessResult = {
  success: boolean;
  error?: string;
  reasoning?: string;
  agentInstance?: { hostname: string; label: string | null };
  isCutAtLimit?: boolean;
};

const scenarioChildProcessResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  reasoning: z.string().optional(),
  /** The connected agent instance that answered the run's turns, when one did. */
  agentInstance: ScenarioAgentInstanceSchema.optional(),
  /** LangWatch ended the voice call at the maximum call duration. */
  isCutAtLimit: z.boolean().optional(),
});

/** Registers a spawned child with the pool and reads its exit, whichever runner it is. */
export function superviseScenarioChild(input: {
  child: ChildProcess;
  jobData: ExecutionJobData;
  pool: ScenarioChildRunPool;
  log: ChildLog;
}): ScenarioChildExecutionSession {
  input.pool.registerChild(input.jobData.scenarioRunId, input.child);
  const completion = observeChild(input);
  return NodeScenarioChildExecutionSession.create({
    child: input.child,
    completion,
    log: input.log,
  });
}

function observeChild(input: {
  child: ChildProcess;
  jobData: ExecutionJobData;
  pool: ScenarioChildRunPool;
  log: ChildLog;
}): Promise<ScenarioExecutionResult> {
  return new Promise((resolve) => {
    const { child, log, pool } = input;
    let stderr = "";
    let stdout = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      log("error", "Child process timed out", { timeoutMs: CHILD_PROCESS.TIMEOUT_MS });
      child.kill();
      resolve({ success: false, error: "Scenario execution timed out" });
    }, CHILD_PROCESS.TIMEOUT_MS);

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      logChildChunk(chunk, "info", log);
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      logChildChunk(chunk, "warn", log);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      pool.deregisterChild(input.jobData.scenarioRunId);
      if (settled) return;
      settled = true;

      resolve(
        childExitResult({
          code,
          stdout,
          stderr,
          log,
          cancelled: pool.wasCancelled(input.jobData.scenarioRunId),
        }),
      );
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      pool.deregisterChild(input.jobData.scenarioRunId);
      if (settled) return;
      settled = true;
      log("error", `Child process error: ${error.message}`);
      resolve({ success: false, error: `Child process error: ${error.message}` });
    });

    child.stdin?.on("error", (error) => {
      log("warn", "Child stdin error", { error: error.message });
    });
  });
}

class NodeScenarioChildExecutionSession implements ScenarioChildExecutionSession {
  static create(options: {
    child: ChildProcess;
    completion: Promise<ScenarioExecutionResult>;
    log: (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => void;
  }): NodeScenarioChildExecutionSession {
    return new NodeScenarioChildExecutionSession(options);
  }

  private started = false;

  private constructor(
    private readonly options: {
      child: ChildProcess;
      completion: Promise<ScenarioExecutionResult>;
      log: (
        level: "info" | "warn" | "error",
        message: string,
        extra?: Record<string, unknown>,
      ) => void;
    },
  ) {}

  execute(data: ChildProcessJobData): Promise<ScenarioExecutionResult> {
    if (this.started) {
      throw new Error("Scenario child execution has already started");
    }
    this.started = true;
    try {
      this.options.child.stdin?.write(JSON.stringify(data));
      this.options.child.stdin?.end();
    } catch (error) {
      this.options.log("warn", "Child stdin write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.options.completion;
  }

  async abort(): Promise<void> {
    this.options.child.kill("SIGTERM");
    await this.options.completion;
  }
}

/** The last result line a child wrote, Node or Go alike, or null when it wrote none. */
export function parseChildProcessResult(stdout: string): ScenarioChildProcessResult | null {
  for (const line of stdout.split("\n").reverse()) {
    const result = parseResultLine(line);
    if (result) return result;
  }
  return null;
}

function parseResultLine(line: string): ScenarioChildProcessResult | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return scenarioChildProcessResultSchema.safeParse(parsed).data ?? null;
  } catch {
    return null;
  }
}

function logChildChunk(chunk: string, level: "info" | "warn", log: ChildLog): void {
  for (const line of chunk.trim().split("\n")) {
    if (line) {
      log(level, line);
    }
  }
}

function childExitResult({
  code,
  stdout,
  stderr,
  log,
  cancelled,
}: {
  code: number | null;
  stdout: string;
  stderr: string;
  log: ChildLog;
  cancelled: boolean;
}): ScenarioExecutionResult {
  if (cancelled) {
    log("info", "Job cancelled via cancel broadcast");
    return { success: false, error: "Job was cancelled", cancelled: true };
  }
  if (code !== 0) {
    const childResult = parseChildProcessResult(stdout);
    const error = childResult?.error?.trim()
      ? childResult.error
      : `Child process exited with code ${code}: ${stderr}`;
    log("error", `Child process exited with code ${code}`, {
      exitCode: code,
      stderr,
    });
    return { success: false, error };
  }

  log("info", "Scenario completed successfully", { exitCode: code });
  // The last JSON line the child wrote is the only place the connected
  // agent instance that answered the run is named; without reading it
  // here a finished run records no instance at all.
  const childResult = parseChildProcessResult(stdout);
  return {
    success: true,
    ...(childResult?.reasoning ? { reasoning: childResult.reasoning } : {}),
    ...(childResult?.agentInstance ? { agentInstance: childResult.agentInstance } : {}),
    ...(childResult?.isCutAtLimit ? { isCutAtLimit: true } : {}),
  };
}
