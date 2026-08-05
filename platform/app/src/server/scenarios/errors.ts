/**
 * Custom error types for scenario domain.
 * These are framework-agnostic and can be mapped to tRPC/HTTP errors in the router layer.
 */

import { ValidationError } from "@langwatch/handled-error";

import type { RedTeamInput } from "./red-team-input";

export class ScenarioNotFoundError extends Error {
  constructor(message = "Scenario not found") {
    super(message);
    this.name = "ScenarioNotFoundError";
  }
}

/**
 * A write that would store an attack the runner cannot carry out — a strategy
 * with nothing to aim at, or planner settings the chosen strategy ignores.
 *
 * Keyed by the offending field so the editor puts the complaint on the input
 * that caused it (`applyHandledErrorToForm` reads `meta.fieldErrors`) and an
 * API or CLI caller gets a field name to act on rather than prose to parse.
 *
 * @see redTeamStateIssue, which decides what counts as one.
 */
export class RedTeamConfigurationError extends ValidationError {
  constructor(issue: { field: keyof RedTeamInput; message: string }) {
    super(issue.message, {
      meta: { fieldErrors: { [issue.field]: [issue.message] } },
    });
    this.name = "RedTeamConfigurationError";
  }
}
