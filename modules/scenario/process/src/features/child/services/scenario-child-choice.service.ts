/**
 * Picks which child channel starts a scenario run: the Go runner when the project's flag is on and
 * its binary is on disk, the Node child otherwise. Voice always runs on the Node child.
 * @see specs/scenarios/go-scenario-runner-choice.feature
 */

import fs from "node:fs";

import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";

import type {
  ScenarioChildBootstrap,
  ScenarioChildEnvironment,
  ScenarioChildExecutionSession,
} from "../../../app/scenario.app.ts";
import type {
  ScenarioChildChannel,
  ScenarioChildNonceRegistry,
  ScenarioChildRunPool,
  ScenarioGoChildChannel,
} from "../../../channels/scenario-child.channel.ts";
import type { ExecutionJobData } from "../../../services/scenario-execution-pool.service.ts";
import type { VoicePublicUrl } from "../../voice/services/voice-public-url.service.ts";

const logger = createLogger("langwatch:scenarios:child-choice");

export const SCENARIO_GO_RUNNER_FLAG_KEY = "release_scenario_go_runner_enabled";

export class ScenarioChildChoiceService implements ScenarioChildBootstrap {
  static create(options: {
    node: ScenarioChildChannel;
    go: ScenarioGoChildChannel;
    featureFlags: Pick<FeatureFlagApi, "isEnabled">;
    binaryExists?: (binaryPath: string) => boolean;
    pool: ScenarioChildRunPool;
    nonces: ScenarioChildNonceRegistry;
    voicePublicUrl?: () => Promise<VoicePublicUrl>;
  }): ScenarioChildChoiceService {
    return new ScenarioChildChoiceService(options);
  }

  #binaryPresent: boolean | undefined;

  private constructor(
    private readonly options: {
      node: ScenarioChildChannel;
      go: ScenarioGoChildChannel;
      featureFlags: Pick<FeatureFlagApi, "isEnabled">;
      binaryExists?: (binaryPath: string) => boolean;
      pool: ScenarioChildRunPool;
      nonces: ScenarioChildNonceRegistry;
      voicePublicUrl?: () => Promise<VoicePublicUrl>;
    },
  ) {}

  start = async (input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): Promise<ScenarioChildExecutionSession> => {
    const runner = (await this.#choose(input.jobData)) ?? this.options.node;
    const { pool, nonces, voicePublicUrl } = this.options;
    return runner.start({ ...input, pool, nonces, voicePublicUrl });
  };

  async #choose(jobData: ExecutionJobData): Promise<ScenarioChildChannel | undefined> {
    if (jobData.target.type === "voice") return void 0;
    if (!(await this.#flagOn(jobData.projectId))) return void 0;
    const { go } = this.options;
    if (!this.#hasBinary(go.binaryPath)) return void 0;
    return go;
  }

  /** A flag read that fails answers off: the Node child is the runner every project has. */
  async #flagOn(projectId: string): Promise<boolean> {
    try {
      return await this.options.featureFlags.isEnabled(SCENARIO_GO_RUNNER_FLAG_KEY, {
        kind: "project",
        projectId,
      });
    } catch (error) {
      logger.warn({ error, projectId }, "Go runner flag read failed; running on the Node child");
      return false;
    }
  }

  /** Looked at once per process: the image either ships the binary or it does not. */
  #hasBinary(binaryPath: string | undefined): boolean {
    if (this.#binaryPresent === undefined) {
      const exists = this.options.binaryExists ?? fs.existsSync;
      this.#binaryPresent = binaryPath !== undefined && exists(binaryPath);
      if (!this.#binaryPresent) {
        logger.warn(
          { binaryPath },
          "Go scenario runner flag is on but its binary is missing; runs stay on the Node child",
        );
      }
    }
    return this.#binaryPresent;
  }
}
