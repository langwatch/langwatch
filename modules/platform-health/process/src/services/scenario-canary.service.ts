/** The scenario canary, ported from main's `health-probes/scenario-canary.service.ts`. */
import { createLogger } from "@langwatch/observability";
import { isTerminalStatus, type ScenarioApi } from "@langwatch/scenario-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { nowInstant } from "@langwatch/time";

import {
  type CanaryConfig,
  type CanaryOutcome,
  type CanaryResult,
  type CanaryVerdict,
  classifyCanaryOutcome,
  isNamedLivePlan,
  parseRunPlanConfig,
  SCENARIO_CANARY_ATTEMPT_BUDGET_MS,
  SCENARIO_CANARY_POLL_INTERVAL_MS,
  SCENARIO_CANARY_TOTAL_BUDGET_MS,
} from "../rules/scenario-canary.rules.ts";

const logger = createLogger("langwatch:scenario-canary");

export type ScenarioCanaryPeers = Readonly<{
  scenarios: Pick<ScenarioApi, "launchRun" | "findScenarioRunData">;
  suites: Pick<SuiteApi, "listByIds" | "list">;
}>;

/** Bounds one boundary await by a real deadline, which the logical clock cannot move. */
export type DeadlineRace = <T>(options: {
  ms: number;
  work: Promise<T>;
}) => Promise<{ timedOut: true } | { value: T }>;

export type CanaryClock = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  raceDeadline: DeadlineRace;
}>;

const raceAgainstRealDeadline: DeadlineRace = ({ ms, work }) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const settled = work.then((value) => ({ value }));
  void settled.catch(() => undefined);
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
};

const REAL_CLOCK: CanaryClock = {
  now: () => nowInstant().epochMilliseconds,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  raceDeadline: raceAgainstRealDeadline,
};

/** Launches one run of a named plan, waits for its judge, retries once, and names what broke. */
export class ScenarioCanaryService {
  readonly #inFlight = new Map<string, Promise<CanaryOutcome>>();

  private constructor(
    private readonly peers: ScenarioCanaryPeers,
    private readonly clock: CanaryClock,
  ) {}

  static create(options: {
    peers: ScenarioCanaryPeers;
    clock?: CanaryClock;
  }): ScenarioCanaryService {
    return new ScenarioCanaryService(options.peers, options.clock ?? REAL_CLOCK);
  }

  async run({
    projectId,
    runPlanId,
  }: {
    projectId: string;
    runPlanId: string;
  }): Promise<CanaryResult> {
    logger.info({ projectId, runPlanId }, "Running scenario canary health check");
    const hardDeadline = this.clock.now() + SCENARIO_CANARY_TOTAL_BUDGET_MS;
    const resolved = await this.#resolveConfig({ projectId, runPlanId, hardDeadline });
    if ("failed" in resolved) return { healthy: false, reason: resolved.failed, durationMs: 0 };

    const key = `${projectId}/${resolved.runPlanId}`;
    if (this.#inFlight.has(key)) return { busy: true };
    const attempt = this.#runWithRetry(resolved, hardDeadline).finally(() => {
      this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, attempt);
    return attempt;
  }

  async #resolveConfig(input: {
    projectId: string;
    runPlanId: string;
    hardDeadline: number;
  }): Promise<CanaryConfig | { failed: "timeout" | "run_failed" }> {
    const { projectId, runPlanId } = input;
    try {
      const raced = await this.clock.raceDeadline({
        ms: input.hardDeadline - this.clock.now(),
        work: this.#findRunPlan({ projectId, runPlanId }),
      });
      if ("timedOut" in raced) {
        logger.error({ projectId, runPlanId }, "Scenario canary run plan lookup timed out");
        return { failed: "timeout" };
      }
      const config = parseRunPlanConfig(raced.value);
      if ("invalid" in config) {
        logger.error(
          { projectId, runPlanId, reason: config.invalid },
          "Scenario canary run plan invalid",
        );
        return { failed: "run_failed" };
      }
      return config;
    } catch (error) {
      logger.error({ error, projectId, runPlanId }, "Scenario canary run plan lookup failed");
      return { failed: "run_failed" };
    }
  }

  async #findRunPlan({ projectId, runPlanId }: { projectId: string; runPlanId: string }) {
    const byId = await this.peers.suites.listByIds({ projectId, ids: [runPlanId] });
    const hit = byId.find((suite) => isNamedLivePlan({ suite, runPlanId, by: "id" }));
    if (hit) return hit;
    const all = await this.peers.suites.list({ projectId });
    return all.find((suite) => isNamedLivePlan({ suite, runPlanId, by: "slug" }));
  }

  async #runWithRetry(config: CanaryConfig, hardDeadline: number): Promise<CanaryOutcome> {
    const startedAt = this.clock.now();
    const first = await this.#attempt(config, hardDeadline);
    const settled =
      first.verdict.healthy || this.clock.now() >= hardDeadline
        ? first
        : await this.#attempt(config, hardDeadline);
    return {
      ...settled.verdict,
      ...(settled.scenarioRunId ? { scenarioRunId: settled.scenarioRunId } : {}),
      durationMs: this.clock.now() - startedAt,
    };
  }

  async #attempt(
    config: CanaryConfig,
    hardDeadline: number,
  ): Promise<{ scenarioRunId?: string; verdict: CanaryVerdict }> {
    const deadline = Math.min(this.clock.now() + SCENARIO_CANARY_ATTEMPT_BUDGET_MS, hardDeadline);
    const timeout: CanaryVerdict = { healthy: false, reason: "timeout" };
    let scenarioRunId: string | undefined;
    try {
      const queued = await this.clock.raceDeadline({
        ms: deadline - this.clock.now(),
        work: this.#launch(config),
      });
      if ("timedOut" in queued) return { verdict: timeout };
      scenarioRunId = queued.value;

      while (this.clock.now() < deadline) {
        const read = await this.clock.raceDeadline({
          ms: deadline - this.clock.now(),
          work: this.peers.scenarios.findScenarioRunData({
            projectId: config.projectId,
            scenarioRunId,
          }),
        });
        if ("timedOut" in read) break;
        if (read.value && isTerminalStatus(read.value.status)) {
          return { scenarioRunId, verdict: classifyCanaryOutcome(read.value) };
        }
        await this.clock.sleep(
          Math.min(SCENARIO_CANARY_POLL_INTERVAL_MS, deadline - this.clock.now()),
        );
      }
      return { scenarioRunId, verdict: timeout };
    } catch (error) {
      logger.error(
        { error, scenarioRunId },
        "Scenario canary attempt failed to launch or read the run",
      );
      return {
        ...(scenarioRunId ? { scenarioRunId } : {}),
        verdict: { healthy: false, reason: "run_failed" },
      };
    }
  }

  async #launch({ projectId, scenarioId, target }: CanaryConfig): Promise<string> {
    const { scenarioRunId } = await this.peers.scenarios.launchRun({
      projectId,
      scenarioId,
      target: { type: target.type, referenceId: target.referenceId },
      note: "scenario canary health check",
      actor: { id: "scenario-canary", label: "api" },
    });
    return scenarioRunId;
  }
}
