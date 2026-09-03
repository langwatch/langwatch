/**
 * The expressions that read a configuration off a run row, and the repository
 * that reads the configurations a project's plans already ran with.
 *
 * Everything a configuration needs lives in the run's metadata, which the
 * fold projection wrote from the queued command: the target type and
 * reference id and the two simulation models under the reserved `langwatch`
 * key, the resolved run parameters beside it. Nothing needs a new column and
 * nothing needs a migration.
 *
 * The run NOTE sits in the same blob and no expression here reads it. One
 * expression answers WHETHER a run carried one, which is a different question:
 * a run plan that takes a note opens its note field ready on the next run, and
 * the text itself changes every run.
 *
 * @see specs/features/agent-testing/run-configuration-history.feature
 */
import type { ResultsFilter } from "@langwatch/scenario-contract";
import {
  MAX_RUN_CONFIGURATIONS,
  RunConfigurationsReadPort,
  type RawRunConfigurationRow,
} from "../../ports/run-configurations-read.port";
import {
  ATOM_SORT_KEY,
  LANGWATCH_METADATA,
  TARGET_KEY_EXPR,
  TARGET_PARAMETERS_EXPR,
  ResultAtomsClickHouseRepository,
  type ResultAtomsClickHouseClientResolver,
} from "./clickhouse.result-atoms.repository";

/** The target's type: `http`, `prompt`, `code` or `workflow`. */
export const TARGET_TYPE_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'targetType')`;

/**
 * A target as one comparable string, `<type>:<targetKey>`.
 *
 * The same two fields the shared key recipe joins, in the same order, so the
 * pre-collapse this drives groups the rows the final key would group: one
 * agent run with two sets of overrides is two targets here as it is there.
 * The final key is still taken in TypeScript from the shared function: this
 * string only decides how many rows leave the database.
 */
export const TARGET_PAIR_EXPR = `concat(${TARGET_TYPE_EXPR}, ':', ${TARGET_KEY_EXPR})`;

/**
 * The simulator model the plan was configured with, '' when it named none.
 *
 * A run recorded before the models were stamped extracts as '' too, which is
 * correct: both mean "no model was chosen" and both key the same way.
 */
export const SIMULATOR_MODEL_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'simulatorModel')`;

/** The judge model the plan was configured with, '' when it named none. */
export const JUDGE_MODEL_EXPR = `JSONExtractString(${LANGWATCH_METADATA}, 'judgeModel')`;

/**
 * The resolved run parameters, as the raw JSON object they were stored as.
 *
 * Raw rather than a map read: the values are strings, numbers and booleans,
 * and re-typing them in SQL would lose which they were. A run with no
 * parameters extracts as the empty string.
 */
export const RUN_PARAMETERS_EXPR = `JSONExtractRaw(ifNull(Metadata, '{}'), 'parameters')`;

/**
 * Only runs the platform pointed at a target can be a configuration.
 *
 * A run pushed from an SDK or from CI carries no target, so the dialog has
 * nothing to offer back for it. Dropping those rows here also keeps the target
 * pair from ever reading as a bare ':'.
 */
export const HAS_TARGET_CLAUSE = `AND JSONExtractString(${LANGWATCH_METADATA}, 'targetReferenceId') != ''`;

/**
 * Whether the run carried a note, as 1 or 0. It never reads the note.
 *
 * A run plan that took a note last time takes one again, so the dialog opens
 * the note block expanded and empty. The text belongs to one run and is
 * carried over by nothing.
 */
export const HAS_NOTE_EXPR = `JSONExtractString(ifNull(Metadata, '{}'), 'note') != ''`;

/**
 * Reads the configurations a project's plans already ran with.
 *
 * A sibling of the atom repository rather than a method on it: the atom reads
 * answer "what happened", this one answers "what was it asked to do". It
 * reuses the atom filter builder on purpose, so the two can never disagree
 * about which version of a run is the current one or which partitions to
 * touch.
 */
export class RunConfigurationsClickHouseRepository extends RunConfigurationsReadPort {
  static create(
    resolveClient: ResultAtomsClickHouseClientResolver,
  ): RunConfigurationsClickHouseRepository {
    return new RunConfigurationsClickHouseRepository(resolveClient);
  }

  private constructor(private readonly resolveClient: ResultAtomsClickHouseClientResolver) {
    super();
  }

  private async getClient(tenantId: string): ReturnType<ResultAtomsClickHouseClientResolver> {
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

    const filters = ResultAtomsClickHouseRepository.buildAtomFilters(filter);
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
              ${ResultAtomsClickHouseRepository.atomScopeSql(filters)}
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
        configurationLimit: String(Math.min(Math.max(1, limit), MAX_RUN_CONFIGURATIONS)),
      },
      format: "JSONEachRow",
    });

    return result.json<RawRunConfigurationRow>();
  }
}
