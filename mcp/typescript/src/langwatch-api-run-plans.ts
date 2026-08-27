import { makeRequest } from "./langwatch-api.js";

/**
 * Client for `/api/v1/run-plans`.
 *
 * A run plan is what you run, and its NAME identifies it: running against a
 * name that exists replaces that plan's configuration, running against a new
 * name creates one. Configuration is the scope, the targets, the repeat count
 * and the two models. Parameters, the note and the idempotency key belong to
 * one run, not to the plan.
 */

/** What a run plan covers. Mirrors `suiteScopeSchema` on the platform. */
export type RunPlanScope =
  | { mode: "all" }
  | { mode: "folders"; folderIds: string[] }
  | { mode: "labels"; labels: string[] }
  | { mode: "cases" };

/** One thing a plan runs its cases against. */
export interface RunPlanTarget {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
}

/** The values a run supplies for the parameters its scenarios declare. */
export type RunParameters = Record<string, string | number | boolean>;

export interface RunPlan {
  id: string;
  name: string;
  slug: string;
  scope: RunPlanScope | null;
  scenarioIds: string[];
  targets: RunPlanTarget[];
  repeatCount: number;
  simulatorModel: string | null;
  judgeModel: string | null;
  labels: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

/** The configuration a run either writes onto a plan or creates it with. */
export interface RunPlanConfig {
  scope: RunPlanScope;
  targets: RunPlanTarget[];
  repeatCount?: number;
  simulatorModel?: string | null;
  judgeModel?: string | null;
  scenarioIds?: string[];
}

export interface RunPlanRunResult {
  scheduled: boolean;
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
  items: Array<{
    scenarioRunId: string;
    scenarioId: string;
    target: RunPlanTarget;
    name: string | null;
  }>;
  runPlanId: string;
  planName: string;
  /** True when this run created the plan, false when it joined an existing one. */
  created: boolean;
  platformUrl: string;
}

export interface RunPlanArchiveResponse {
  id: string;
  archived: boolean;
}

/** Lists the run plans of the project. */
export async function listRunPlans(params?: {
  includeArchived?: boolean;
}): Promise<RunPlan[]> {
  const query = params?.includeArchived ? "?includeArchived=true" : "";
  return makeRequest("GET", `/api/v1/run-plans${query}`) as Promise<RunPlan[]>;
}

/** Retrieves a single run plan by id. */
export async function getRunPlan(id: string): Promise<RunPlan> {
  return makeRequest(
    "GET",
    `/api/v1/run-plans/${encodeURIComponent(id)}`,
  ) as Promise<RunPlan>;
}

/**
 * Runs a configuration by plan name. A name that exists is replaced with this
 * configuration, a name that does not is created. Sending no name lets the
 * server derive one.
 */
export async function runRunPlan(data: {
  name?: string;
  config: RunPlanConfig;
  idempotencyKey?: string;
  parameters?: RunParameters;
  note?: string;
}): Promise<RunPlanRunResult> {
  return makeRequest(
    "POST",
    "/api/v1/run-plans/run",
    data,
  ) as Promise<RunPlanRunResult>;
}

/** Runs a plan again with the configuration it already holds. */
export async function rerunRunPlan(
  id: string,
  data?: {
    idempotencyKey?: string;
    parameters?: RunParameters;
    note?: string;
  },
): Promise<RunPlanRunResult> {
  return makeRequest(
    "POST",
    `/api/v1/run-plans/${encodeURIComponent(id)}/run`,
    data ?? {},
  ) as Promise<RunPlanRunResult>;
}

/** Archives a run plan. */
export async function archiveRunPlan(
  id: string,
): Promise<RunPlanArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/v1/run-plans/${encodeURIComponent(id)}`,
  ) as Promise<RunPlanArchiveResponse>;
}
