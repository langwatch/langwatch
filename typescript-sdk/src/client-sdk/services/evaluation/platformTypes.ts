/**
 * Types for platform-configured evaluations (Evaluations V3)
 */

/**
 * Summary of a completed evaluation run
 */
export type EvaluationRunSummary = {
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
 * Options for running a platform evaluation
 */
export type RunEvaluationOptions = {
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
 * Final result of a platform evaluation run
 */
export type EvaluationRunResult = {
  runId: string;
  status: "completed" | "failed" | "stopped";
  passed: number;
  failed: number;
  passRate: number;
  duration: number;
  runUrl: string;
  summary: EvaluationRunSummary;
  /**
   * Print a CI-friendly summary of the results
   * @param exitOnFailure - If true (default), calls process.exit(1) when there are failures
   */
  printSummary: (exitOnFailure?: boolean) => void;
};
