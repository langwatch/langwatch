import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { ResultsFilter } from "../result-atoms/atom.types";
import {
  ATOM_SORT_KEY,
  atomScopeSql,
  buildAtomFilters,
  TARGET_PARAMETERS_EXPR,
} from "../result-atoms/atom-sql";
import {
  HAS_NOTE_EXPR,
  HAS_TARGET_CLAUSE,
  JUDGE_MODEL_EXPR,
  RUN_PARAMETERS_EXPR,
  SIMULATOR_MODEL_EXPR,
  TARGET_PAIR_EXPR,
} from "./run-configuration-sql";

/**
 * How many configurations one read returns, at most.
 *
 * The cap applies AFTER the database has already folded runs into distinct
 * configurations, so it bounds the answer rather than the history: a plan run
 * nightly for a year with one setup costs one row, not three hundred and
 * sixty-five. A scope reaching this many distinct configurations has more
 * history than a dropdown can show anyway.
 */
export const MAX_RUN_CONFIGURATIONS = 200;

/**
 * One configuration as ClickHouse folds it, before the plan row is joined.
 *
 * Every value is a string because ClickHouse serialises UInt64 that way, and
 * because the parameters are handed over as the raw JSON they were stored as.
 */
export interface RawRunConfigurationRow {
  SetId: string;
  /** `<type>:<targetKey>` per target, sorted by the database. */
  TargetPairs: string[];
  /**
   * The raw overrides of each target, '' for a target with none, in the same
   * order as `TargetPairs`.
   */
  TargetParameters: string[];
  RepeatCount: string;
  SimulatorModel: string;
  JudgeModel: string;
  /**
   * The raw merged parameters of the first scenario run against a target
   * with no overrides, or of the first scenario run at all when every target
   * carries some; '' when the run resolved none. They include the overrides
   * of the target that run went against, which `FirstTargetParameters` names
   * so they can be taken out.
   */
  Parameters: string;
  /** The raw overrides of the target `Parameters` was read from, or ''. */
  FirstTargetParameters: string;
  /** "1" when any run of this configuration carried a note, never the note. */
  UsesNote: string;
  LastRunAtMs: string;
}

/**
 * Reads the configurations a project's plans already ran with.
 *
 * A sibling of the atom repository rather than a method on it: the atom reads
 * answer "what happened", this one answers "what was it asked to do". It
 * reuses the atom filter builder on purpose, so the two can never disagree
 * about which version of a run is the current one or which partitions to
 * touch.
 */
export class RunConfigurationsClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private async getClient(tenantId: string): Promise<ClickHouseClient> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }
    return this.resolveClient(tenantId);
  }

  /**
   * One row per distinct configuration, newest first.
   *
   * Four folds, innermost out:
   *
   * 1. the atoms in scope, deduped to the latest version of each run;
   * 2. one row per scenario and target of a batch, whose COUNT is the repeat
   *    count the batch was started with;
   * 3. one row per batch, which is one run of one plan: its targets with
   *    their overrides, the largest of those counts, its models, and the
   *    FIRST scenario run's parameters beside the overrides of its target.
   *    A run against a target with no overrides is preferred for that read,
   *    so the run-level values are not hidden under a target's own;
   * 4. one row per distinct configuration, carrying the newest run of it.
   *
   * The last fold is what makes the cap meaningful. The key the dialog
   * compares against is still built in TypeScript from the shared recipe; the
   * grouping here only decides how many rows travel.
   */
  async findConfigurations({
    filter,
    limit = MAX_RUN_CONFIGURATIONS,
  }: {
    filter: ResultsFilter;
    limit?: number;
  }): Promise<RawRunConfigurationRow[]> {
    // An empty set list means "none of them". Sending no filter at all would
    // read the whole project instead, which is the opposite answer.
    if (filter.scenarioSetIds?.length === 0) return [];

    const filters = buildAtomFilters(filter);
    const client = await this.getClient(filter.projectId);

    const result = await client.query({
      query: `SELECT
          SetId,
          arrayMap(target -> target.1, Targets) AS TargetPairs,
          arrayMap(target -> target.2, Targets) AS TargetParameters,
          toString(RepeatCount)     AS RepeatCount,
          SimulatorModel,
          JudgeModel,
          Parameters,
          FirstTargetParameters,
          toString(max(HasNote))    AS UsesNote,
          toString(max(BatchRunAt)) AS LastRunAtMs
        FROM (
          SELECT
            SetId,
            arraySort(groupUniqArray(tuple(TargetPair, TargetParameters))) AS Targets,
            max(PairRuns)                          AS RepeatCount,
            max(SimulatorModel)                    AS SimulatorModel,
            max(JudgeModel)                        AS JudgeModel,
            if(countIf(TargetParameters = '') > 0,
               argMinIf(Parameters, FirstRunId, TargetParameters = ''),
               argMin(Parameters, FirstRunId))     AS Parameters,
            if(countIf(TargetParameters = '') > 0,
               '',
               argMin(TargetParameters, FirstRunId)) AS FirstTargetParameters,
            max(HasNote)                           AS HasNote,
            max(PairRunAt)                         AS BatchRunAt
          FROM (
            SELECT
              SetId,
              BatchRunId,
              TargetPair,
              any(TargetParameters)      AS TargetParameters,
              count()                    AS PairRuns,
              max(SimulatorModel)        AS SimulatorModel,
              max(JudgeModel)            AS JudgeModel,
              any(Parameters)            AS Parameters,
              max(HasNote)               AS HasNote,
              min(ScenarioRunId)         AS FirstRunId,
              max(RunAt)                 AS PairRunAt
            FROM (
              SELECT
                ScenarioSetId              AS SetId,
                BatchRunId,
                ScenarioId,
                ScenarioRunId,
                ${TARGET_PAIR_EXPR}        AS TargetPair,
                ${TARGET_PARAMETERS_EXPR}  AS TargetParameters,
                ${SIMULATOR_MODEL_EXPR}    AS SimulatorModel,
                ${JUDGE_MODEL_EXPR}        AS JudgeModel,
                ${RUN_PARAMETERS_EXPR}     AS Parameters,
                ${HAS_NOTE_EXPR}           AS HasNote,
                ${ATOM_SORT_KEY}           AS RunAt
              ${atomScopeSql(filters)}
                ${HAS_TARGET_CLAUSE}
            )
            GROUP BY SetId, BatchRunId, ScenarioId, TargetPair
          )
          GROUP BY SetId, BatchRunId
        )
        GROUP BY
          SetId, Targets, RepeatCount, SimulatorModel, JudgeModel,
          Parameters, FirstTargetParameters
        ORDER BY max(BatchRunAt) DESC
        LIMIT {configurationLimit:UInt32}`,
      query_params: {
        tenantId: filter.projectId,
        ...filters.params,
        configurationLimit: String(
          Math.min(Math.max(1, limit), MAX_RUN_CONFIGURATIONS),
        ),
      },
      format: "JSONEachRow",
    });

    return result.json<RawRunConfigurationRow>();
  }
}
