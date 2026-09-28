/**
 * The run's folds in Redis beside main's progress key, 24-hour TTL: the plan and the progress
 * apart, so a cell's result never rewrites the plan. The poller's own key is not touched yet.
 */
import type { FoldStateRead } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { z } from "zod";

import {
  ExperimentRunFoldRepository,
  type ExperimentRunPlanFoldState,
  experimentRunPlanFoldStateSchema,
  type ExperimentRunProgressState,
  experimentRunProgressStateSchema,
} from "../experiment-run-fold.repository.ts";

const logger = createLogger("langwatch:experiment:run-fold");

const RUN_KEY_PREFIX = "eval_v3_run:";
const RUN_TTL_SECONDS = 86_400;

const progressKey = (runKey: string): string => `${RUN_KEY_PREFIX}${runKey}:progress`;
const planKey = (runKey: string): string => `${RUN_KEY_PREFIX}${runKey}:plan`;

export class RedisExperimentRunFoldRepository extends ExperimentRunFoldRepository {
  static create(options: { redis: ProcessMembers["redis"] }): RedisExperimentRunFoldRepository {
    return new RedisExperimentRunFoldRepository(options.redis);
  }

  private constructor(private readonly redis: ProcessMembers["redis"]) {
    super();
  }

  readPlan({ runKey }: { runKey: string }): Promise<FoldStateRead<ExperimentRunPlanFoldState>> {
    return this.read({ key: planKey(runKey), schema: experimentRunPlanFoldStateSchema });
  }

  async writePlan({
    runKey,
    state,
  }: {
    runKey: string;
    state: ExperimentRunPlanFoldState;
  }): Promise<void> {
    await this.redis.set(planKey(runKey), JSON.stringify(state), "EX", RUN_TTL_SECONDS);
  }

  readProgress({ runKey }: { runKey: string }): Promise<FoldStateRead<ExperimentRunProgressState>> {
    return this.read({ key: progressKey(runKey), schema: experimentRunProgressStateSchema });
  }

  async writeProgress({
    runKey,
    state,
  }: {
    runKey: string;
    state: ExperimentRunProgressState;
  }): Promise<void> {
    await this.redis.set(progressKey(runKey), JSON.stringify(state), "EX", RUN_TTL_SECONDS);
  }

  /** A value that no longer parses reads as empty, so the fold starts over rather than wedging. */
  private async read<Schema extends z.ZodTypeAny>({
    key,
    schema,
  }: {
    key: string;
    schema: Schema;
  }): Promise<FoldStateRead<z.infer<Schema>>> {
    const value = await this.redis.get(key);
    if (!value) return { kind: "empty" };

    const parsed = schema.safeParse(JSON.parse(value));
    if (!parsed.success) {
      logger.error({ key, issues: parsed.error.issues.length }, "a run fold did not parse");
      return { kind: "empty" };
    }

    return { kind: "folded", state: parsed.data };
  }
}
