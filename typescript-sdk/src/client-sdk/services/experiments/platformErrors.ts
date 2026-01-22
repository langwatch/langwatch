/**
 * Error classes for platform experiments API (Experiments Workbench)
 */

/**
 * Base error for experiment operations
 */
export class ExperimentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentsError";
  }
}

/**
 * Error when experiment is not found
 */
export class ExperimentNotFoundError extends ExperimentsError {
  constructor(slug: string) {
    super(`Experiment not found: ${slug}`);
    this.name = "ExperimentNotFoundError";
  }
}

/**
 * Error when experiment run times out
 */
export class ExperimentTimeoutError extends ExperimentsError {
  readonly runId: string;
  readonly progress: number;
  readonly total: number;

  constructor(runId: string, progress: number, total: number) {
    super(`Experiment run timed out: ${runId} (${progress}/${total} completed)`);
    this.name = "ExperimentTimeoutError";
    this.runId = runId;
    this.progress = progress;
    this.total = total;
  }
}

/**
 * Error when experiment run fails
 */
export class ExperimentRunFailedError extends ExperimentsError {
  readonly runId: string;
  readonly errorMessage: string;

  constructor(runId: string, errorMessage: string) {
    super(`Experiment run failed: ${errorMessage}`);
    this.name = "ExperimentRunFailedError";
    this.runId = runId;
    this.errorMessage = errorMessage;
  }
}

/**
 * Error from the experiments API
 */
export class ExperimentsApiError extends ExperimentsError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ExperimentsApiError";
    this.statusCode = statusCode;
  }
}
