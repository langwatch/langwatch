import { makeRequest } from "./langwatch-api.js";
import type {
  RunParameters,
  RunPlanRunResult,
} from "./langwatch-api-run-plans.js";
import type { RunPlanTargetWire } from "./schemas/run-plan.js";

/**
 * Client for `/api/v1/test-suites`.
 *
 * A test suite groups scenarios: a name and the scenarios filed in it.
 * Running one is sugar over a run plan, so the run returns the same result a
 * run plan does.
 */

export interface TestSuite {
  id: string;
  name: string;
  slug: string;
  scenarioIds: string[];
  scenarioCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}

export interface TestSuiteDetail extends TestSuite {
  scenarios: Array<{ id: string; name: string }>;
}

export interface TestSuiteArchiveResponse {
  id: string;
  archived: boolean;
}

/** Lists the test suites of the project. */
export async function listTestSuites(): Promise<TestSuite[]> {
  return makeRequest("GET", "/api/v1/test-suites") as Promise<TestSuite[]>;
}

/** Creates a test suite. */
export async function createTestSuite(data: {
  name: string;
}): Promise<TestSuite> {
  return makeRequest(
    "POST",
    "/api/v1/test-suites",
    data,
  ) as Promise<TestSuite>;
}

/** Retrieves a test suite with the scenarios filed in it. */
export async function getTestSuite(id: string): Promise<TestSuiteDetail> {
  return makeRequest(
    "GET",
    `/api/v1/test-suites/${encodeURIComponent(id)}`,
  ) as Promise<TestSuiteDetail>;
}

/** Renames a test suite. */
export async function renameTestSuite(params: {
  id: string;
  name: string;
}): Promise<TestSuite> {
  return makeRequest(
    "PATCH",
    `/api/v1/test-suites/${encodeURIComponent(params.id)}`,
    { name: params.name },
  ) as Promise<TestSuite>;
}

/** Archives a test suite and the scenarios filed in it. */
export async function archiveTestSuite(
  id: string,
): Promise<TestSuiteArchiveResponse> {
  return makeRequest(
    "DELETE",
    `/api/v1/test-suites/${encodeURIComponent(id)}`,
  ) as Promise<TestSuiteArchiveResponse>;
}

/**
 * Runs every scenario of a test suite against the given targets. The server
 * creates or joins the run plan named "<suite name> <target name>" when no
 * name is sent.
 */
export async function runTestSuite(
  id: string,
  data: {
    targets: RunPlanTargetWire[];
    name?: string;
    repeatCount?: number;
    simulatorModel?: string | null;
    judgeModel?: string | null;
    parameters?: RunParameters;
    note?: string;
    idempotencyKey?: string;
  },
): Promise<RunPlanRunResult> {
  return makeRequest(
    "POST",
    `/api/v1/test-suites/${encodeURIComponent(id)}/run`,
    data,
  ) as Promise<RunPlanRunResult>;
}
