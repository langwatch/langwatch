import { makeRequest } from "./langwatch-api.js";

// --- Evaluator types ---

export interface EvaluatorSummary {
  id: string;
  projectId: string;
  name: string;
  slug: string | null;
  type: string;
  config: Record<string, unknown> | null;
  workflowId: string | null;
  copiedFromEvaluatorId: string | null;
  createdAt: string;
  updatedAt: string;
  fields: Array<{ identifier: string; type: string; optional?: boolean }>;
  outputFields: Array<{ identifier: string; type: string; optional?: boolean }>;
  workflowName?: string;
  workflowIcon?: string;
}

// --- Helpers ---

/**
 * Extracts the evaluatorType from an evaluator's config.
 * Centralises the cast so callers don't repeat it.
 */
export function getEvaluatorType(
  evaluator: Pick<EvaluatorSummary, "config">,
): string | undefined {
  return (evaluator.config as Record<string, unknown> | null)
    ?.evaluatorType as string | undefined;
}

// --- Evaluator API functions ---

/** Lists all evaluators in the project. */
export async function listEvaluators(): Promise<EvaluatorSummary[]> {
  return makeRequest("GET", "/api/evaluators") as Promise<EvaluatorSummary[]>;
}

/** Retrieves a single evaluator by ID or slug. */
export async function getEvaluator(idOrSlug: string): Promise<EvaluatorSummary> {
  return makeRequest(
    "GET",
    `/api/evaluators/${encodeURIComponent(idOrSlug)}`,
  ) as Promise<EvaluatorSummary>;
}

/** Creates a new evaluator. */
export async function createEvaluator(data: {
  name: string;
  config: Record<string, unknown>;
}): Promise<EvaluatorSummary> {
  return makeRequest("POST", "/api/evaluators", data) as Promise<EvaluatorSummary>;
}

/** Updates an existing evaluator. */
export async function updateEvaluator(params: {
  id: string;
  name?: string;
  config?: Record<string, unknown>;
}): Promise<EvaluatorSummary> {
  const { id, ...data } = params;
  return makeRequest(
    "PUT",
    `/api/evaluators/${encodeURIComponent(id)}`,
    data,
  ) as Promise<EvaluatorSummary>;
}
