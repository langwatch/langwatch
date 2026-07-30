/**
 * Custom error types for scenario domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

export class ScenarioNotFoundError extends Error {
  constructor(message = "Scenario not found") {
    super(message);
    this.name = "ScenarioNotFoundError";
  }
}
