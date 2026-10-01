/**
 * The run's folds in Redis, 24-hour TTL: the progress at main's poller key by runId, the plan
 * beside it by aggregate key, so a cell's result never rewrites the plan.
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
  type ExperimentRunStartRecord,
  experimentRunStartRecordSchema,
} from "../experiment-run-fold.repository.ts";

const logger = createLogger("langwatch:experiment:run-fold");

const RUN_KEY_PREFIX = "eval_v3_run:";
const RUN_TTL_SECONDS = 86_400;

const progressKey = (runId: string): string => `${RUN_KEY_PREFIX}${runId}`;
const planKey = (runKey: string): string => `${RUN_KEY_PREFIX}${runKey}:plan`;
const startKey = (runId: string): string => `${RUN_KEY_PREFIX}${runId}:start`;

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

  readRunProgress({
    runId,
  }: {
    runId: string;
  }): Promise<FoldStateRead<ExperimentRunProgressState>> {
    return this.read({ key: progressKey(runId), schema: experimentRunProgressStateSchema });
  }

  async writeProgress({ state }: { state: ExperimentRunProgressState }): Promise<void> {
    await this.redis.set(progressKey(state.runId), JSON.stringify(state), "EX", RUN_TTL_SECONDS);
  }

  async recordRunStart({ start }: { start: ExperimentRunStartRecord }): Promise<void> {
    await this.redis.set(startKey(start.runId), JSON.stringify(start), "EX", RUN_TTL_SECONDS);
  }

  async findRunStart({ runId }: { runId: string }): Promise<ExperimentRunStartRecord[]> {
    const read = await this.read({ key: startKey(runId), schema: experimentRunStartRecordSchema });

    return read.kind === "folded" ? [read.state] : [];
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
