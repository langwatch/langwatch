import type { ChildProcess } from "node:child_process";

import type {
  ScenarioChildEnvironment,
  ScenarioChildExecutionSession,
} from "../app/scenario.app.ts";
import type { VoicePublicUrl } from "../features/voice/services/voice-public-url.service.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";

/** The pool a spawned child registers with, so a cancel or a drain can stop it. */
export interface ScenarioChildRunPool {
  registerChild(scenarioRunId: string, child: ChildProcess): void;
  deregisterChild(scenarioRunId: string): void;
  wasCancelled(scenarioRunId: string): boolean;
}

/** Where a voice child registers the media nonce the worker's door will be dialled with. */
export interface ScenarioChildNonceRegistry {
  register(input: { nonce: string; child: ChildProcess }): Promise<void>;
}

/**
 * Starts one scenario run in a child process the module does not own, writes the job to its
 * stdin and reads the result line it writes last. Node and Go children speak the same protocol.
 */
export interface ScenarioChildChannel {
  start(input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
    pool: ScenarioChildRunPool;
    nonces: ScenarioChildNonceRegistry;
    /** Acquires the worker's public media origin, asked only when a voice child starts. */
    voicePublicUrl?: () => Promise<VoicePublicUrl>;
  }): Promise<ScenarioChildExecutionSession>;
}

/** The Go runner, and where its binary is: absent when the deployment names none. */
export interface ScenarioGoChildChannel extends ScenarioChildChannel {
  readonly binaryPath: string | undefined;
}
