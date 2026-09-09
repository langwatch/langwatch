import { moduleApi } from "@langwatch/runtime-composition";
import type {
  ScenarioTestSuite,
  ScenarioTestSuiteCreateInput,
  ScenarioTestSuiteIdInput,
  SimulationExternalSetSummary,
  SimulationProjectDateRangeInput,
} from "@langwatch/scenario-contract";
import type {
  CreateSuiteCommand,
  Suite,
  SuiteArchivedNamesInput,
  SuiteIdInput,
  SuiteRunAllInput,
  SuiteRunAllResult,
  SuiteRunInput,
  SuiteRunResult,
  SuiteRunPlanInput,
  SuiteRunPlanResult,
  UpdateSuiteCommand,
} from "./index.ts";

/** Callable capability exposed by the composed Suite application. */
export interface SuiteApi {
  listByIds(input: { projectId: string; ids: readonly string[] }): Promise<Suite[]>;
  list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]>;
  listTestSuites(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<ScenarioTestSuite[]>;
  resolveActiveScenarioNames(input: {
    scenarioIds: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]>;
  getByIdOrTestSuite(
    input: SuiteIdInput,
  ): Promise<
    Readonly<{ kind: "suite"; suite: Suite } | { kind: "test_suite"; testSuite: ScenarioTestSuite }>
  >;
  /** The organization is the application's to resolve, so no caller states it. */
  resolveArchivedNames(
    input: Omit<SuiteArchivedNamesInput, "organizationId">,
  ): Promise<{ scenarios: Record<string, string>; targets: Record<string, string> }>;
  getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
  create(input: CreateSuiteCommand): Promise<Suite>;
  createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite>;
  update(
    input: UpdateSuiteCommand,
  ): Promise<
    Readonly<{ kind: "suite"; suite: Suite } | { kind: "test_suite"; testSuite: ScenarioTestSuite }>
  >;
  duplicate(input: SuiteIdInput): Promise<Suite>;
  archive(input: SuiteIdInput): Promise<Suite>;
  archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite>;
  renameTestSuite(input: ScenarioTestSuiteIdInput & { name: string }): Promise<ScenarioTestSuite>;
  run(input: Omit<SuiteRunInput, "organizationId">): Promise<SuiteRunResult>;
  runAll(input: Omit<SuiteRunAllInput, "organizationId">): Promise<SuiteRunAllResult>;
  runPlan(input: Omit<SuiteRunPlanInput, "organizationId">): Promise<SuiteRunPlanResult>;
  getOrganizationId(projectId: string): Promise<string>;
}

export const SuiteApi = moduleApi<SuiteApi>("suite");
