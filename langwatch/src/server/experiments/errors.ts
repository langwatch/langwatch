/**
 * Custom error types for experiment domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

export class ExperimentNotFoundError extends Error {
  constructor(message = "Experiment not found") {
    super(message);
    this.name = "ExperimentNotFoundError";
  }
}
