/**
 * The procedures this family calls, and the hooks that call them.
 */

import type { AgentApiUpdateOutput, UpdateAgentCommand } from "@langwatch/agent-contract";
import type {
  ModelDefaultResolvedTrpcOutput,
  ModelProviderListAllForProjectTrpcOutput,
} from "@langwatch/model-provider-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * A payload no contract package publishes yet.
 */
// oxlint-disable-next-line no-explicit-any
type Unpublished = any;

type Q = { query: { input: Unpublished; output: Unpublished } };

/**
 * A LIST procedure, stated as a list.
 */
type QL = { query: { input: Unpublished; output: Unpublished[] } };
type M = { mutation: { input: Unpublished; output: Unpublished } };
type S = { subscription: { input: Unpublished; output: Unpublished } };

export type ScenarioApiMap = {
  scenarios: {
    getAll: QL;
    getById: Q;
    getByIdIncludingArchived: Q;
    getExternalSetSummaries: QL;
    getLastResultSummaries: QL;
    getBatchRunData: Q;
    getScenarioSetBatchHistory: Q;
    getScenarioSetBatchRunCount: Q;
    getScenarioSetRunData: Q;
    getSuiteRunData: Q;
    getSuiteRunFreshness: Q;
    getRunState: Q;
    getVersion: Q;
    listVersions: Q;
    create: M;
    update: M;
    duplicate: M;
    archive: M;
    batchArchive: M;
    moveToTestSuite: M;
    restoreVersion: M;
    run: M;
    cancelJob: M;
    cancelBatchRun: M;
    /** The Results tab's fold: one row per group, over the whole window. */
    getResultsOverview: Q;
    /** The rows behind one opened group. */
    getResultAtoms: Q;
    /** The scenarios a run named that no stored scenario row matches. */
    getCodeScenarios: QL;
    /** The targets a run went against, as the runs themselves recorded them. */
    getRunTargets: QL;
    /** What the previous runs of this scope were configured with. */
    getRunConfigurations: QL;
    /** The live board. One entry per simulation event on the project. */
    onSimulationUpdate: S;
    /** The tab follower: who else is watching this scenario run. */
    onScenarioTabPresence: S;
  };

  suites: {
    getAll: QL;
    getById: Q;
    getSummaries: Q;
    resolveArchivedNames: Q;
    create: M;
    update: M;
    duplicate: M;
    archive: M;
    run: M;
    runAll: M;
    /** Starts one run plan, which is a suite of the `run_plan` kind. */
    runPlan: M;
    /**
     * The test suites of a project.
     */
    testSuites: {
      getAll: QL;
      create: M;
      rename: M;
      archive: M;
    };
  };

  /**
   * THE BORROWED VOCABULARY, one segment per feature these screens reach.
   */
  agents: {
    getAll: QL;
    getById: Q;
    getRelatedEntities: Q;
    create: M;
    update: { mutation: { input: UpdateAgentCommand; output: AgentApiUpdateOutput } };
    delete: M;
    cascadeArchive: M;
    /** One scenario run against a saved agent, from the agents page. */
    testRun: M;
    /** One turn against a saved agent, from the editor's test panel. */
    testTurn: M;
  };
  /**
   * What the reader may do here.
   */
  authz: {
    effectivePermissions: {
      query: {
        input: { projectId?: string; organizationId?: string };
        output: { permissions: string[] };
      };
    };
  };
  /**
   * One browser-visible release flag, resolved for the reader.
   */
  featureFlag: {
    isEnabled: {
      query: {
        input: {
          flag: string;
          projectId: string | null;
          organizationId: string | null;
        };
        output: { enabled: boolean };
      };
    };
  };
  export: { onScenarioRunExportProgress: S };
  httpProxy: { execute: M };
  modelProvider: {
    getResolvedDefault: {
      query: {
        input: { projectId: string; featureKey: string };
        output: ModelDefaultResolvedTrpcOutput;
      };
    };
    listAllForProjectForFrontend: {
      query: { input: { projectId: string }; output: ModelProviderListAllForProjectTrpcOutput };
    };
  };
  /**
   * The workspace graph, narrowed to what this family needs.
   */
  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          slug?: string;
          teams: Array<{
            id: string;
            name: string;
            slug?: string;
            isPersonal?: boolean;
            ownerUserId?: string | null;
            members?: Array<{ userId: string }>;
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              apiKey?: string;
              firstMessage?: boolean;
            }>;
          }>;
        }>;
      };
    };
    /**
     * The organization's members, read only to put a name on a run's actor.
     */
    getOrganizationWithMembersAndTheirTeams: Q;
  };
  prompts: { getAllPromptsForProject: QL };
  traces: { getById: Q };
  workflow: { create: M };
};

/** What each procedure in the map takes. */
export type RouterInputs = { [K in keyof ScenarioApiMap]: InputsOf<ScenarioApiMap[K]> };

/** What each procedure in the map answers. */
export type RouterOutputs = { [K in keyof ScenarioApiMap]: OutputsOf<ScenarioApiMap[K]> };

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };

type OutputsOf<TNode> = TNode extends { query: { output: infer TOut } }
  ? TOut
  : TNode extends { mutation: { output: infer TOut } }
    ? TOut
    : TNode extends { subscription: { output: infer TOut } }
      ? TOut
      : { [K in keyof TNode]: OutputsOf<TNode[K]> };

export const api = createFeatureApi<ScenarioApiMap>();

/** The same object, under the name the process shell mounts it by. */
export const scenarioApi = api;
