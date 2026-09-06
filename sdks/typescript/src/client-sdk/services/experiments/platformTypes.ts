/**
 * Types for platform-configured experiments (Experiments Workbench)
 */

/**
 * Summary of a completed experiment run
 */
export type ExperimentRunSummary = {
  runId?: string;
  totalCells?: number;
  completedCells?: number;
  failedCells?: number;
  duration?: number;
  runUrl?: string;
  timestamps?: {
    startedAt: number;
    finishedAt?: number;
    stoppedAt?: number;
  };
  targets?: Array<{
    targetId: string;
    name: string;
    passed: number;
    failed: number;
    avgLatency: number;
    totalCost: number;
  }>;
  evaluators?: Array<{
    evaluatorId: string;
    name: string;
    passed: number;
    failed: number;
    passRate: number;
    avgScore?: number;
  }>;
  totalPassed?: number;
  totalFailed?: number;
  passRate?: number;
  totalCost?: number;
};

/**
 * Options for running a platform experiment
 */
export type RunExperimentOptions = {
  /**
   * Polling interval in milliseconds (default: 2000)
   */
  pollInterval?: number;
  /**
   * Maximum time to wait for completion in milliseconds (default: 600000 = 10 minutes)
   */
  timeout?: number;
  /**
   * Callback for progress updates
   */
  onProgress?: (progress: number, total: number) => void;
};

/**
 * Inputs that override a platform experiment or workflow run on the server.
 *
 * `data` and `datasetId` are mutually exclusive (the backend rejects passing
 * both). `parameters` overrides target parameters (e.g. prompt variables) and
 * `rowIndices` restricts execution to a subset of the configured dataset.
 */
export type RunWithResultsOptions = {
  /**
   * Inline rows to evaluate. Mutually exclusive with `datasetId`.
   */
  data?: Array<Record<string, unknown>>;
  /**
   * Id of a saved dataset to evaluate. Mutually exclusive with `data`.
   */
  datasetId?: string;
  /**
   * Target parameter overrides (e.g. prompt variables, model settings).
   */
  parameters?: Record<string, string | number | boolean>;
  /**
   * Subset of dataset row indices to run.
   */
  rowIndices?: number[];
} & RunExperimentOptions;

/**
 * A single per-row result, mirroring one row of the python SDK's results
 * DataFrame (`_build_df_from_platform`).
 */
export type ExperimentRowResult = {
  /**
   * Index of the dataset row this result belongs to.
   */
  index: number;
  /**
   * Target id, present only for multi-target runs.
   */
  target?: string;
  /**
   * Flattened dataset entry fields for this row.
   */
  input: Record<string, unknown>;
  /**
   * Output produced by the target (`predicted.output`).
   */
  output: unknown;
  /**
   * Trace id of the target execution for this row.
   */
  traceId: string;
  /**
   * Cost of the target execution, when measured.
   */
  cost?: number;
  /**
   * Duration of the target execution in milliseconds, when measured.
   */
  duration?: number;
  /**
   * Error message for this row, when the target execution failed.
   */
  error?: string;
  /**
   * Evaluation results for this row keyed by evaluator name.
   */
  evaluations: Record<string, { score?: number; passed?: boolean }>;
};

/**
 * Result of a platform experiment or workflow run, including per-row results
 * and a link to the run in LangWatch.
 */
export type ExperimentRunWithResults = {
  runId: string;
  runUrl: string;
  status: string;
  summary: ExperimentRunSummary;
  rows: ExperimentRowResult[];
};

/**
 * Final result of a platform experiment run
 */
export type ExperimentRunResult = {
  runId: string;
  status: "completed" | "failed" | "stopped";
  passed: number;
  failed: number;
  passRate: number;
  duration: number;
  runUrl: string;
  summary: ExperimentRunSummary;
  /**
   * Print a CI-friendly summary of the results
   * @param exitOnFailure - If true (default), calls process.exit(1) when there are failures
   */
  printSummary: (exitOnFailure?: boolean) => void;
  /**
   * Human-readable string representation
   */
  toString: () => string;
};
