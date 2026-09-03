/**
 * The procedures this family calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `trace-api.ts`,
 * `workflow-api.ts`, `gateway-api.ts` and every other family's map say of
 * themselves: the procedures are mounted by the process out of
 * `@langwatch/scenario-server`, `@langwatch/agent-server`,
 * `@langwatch/prompt-server` and half a dozen more, which a web package may not
 * import even for a type, and the router type does not exist until a process
 * instantiates it.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `scenarios`, `suites`, `agents`,
 * `prompts` and the rest are mount points on the root router, and tRPC hashes
 * that path into the React Query cache key; spell one differently and these
 * hooks quietly stop sharing a cache with the `api.*` call sites that have not
 * moved.
 *
 * THREE OF THESE ARE LIVE. `scenarios.onSimulationUpdate` is what makes a run
 * board move while a batch is running, `scenarios.onScenarioTabPresence` is the
 * tab follower, and `export.onScenarioRunExportProgress` drives the export
 * progress bar. They are declared as `subscription` and the platform serves
 * them over the SSE lane; nothing about the call sites changed.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 *
 * `api` is the exported name rather than `scenarioApi` because that is what a
 * hundred moved call sites already write. `scenarioApi` is the same object
 * under the name the process shell mounts it by.
 */

import type { AgentApiUpdateOutput, UpdateAgentCommand } from "@langwatch/agent-contract";
import type {
  ModelDefaultResolvedTrpcOutput,
  ModelProviderListAllForProjectTrpcOutput,
} from "@langwatch/model-provider-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * A payload no contract package publishes yet.
 *
 * The convention the studio family introduced and every family since has kept:
 * a procedure whose row type still lives in the application's Prisma client
 * gets `any` rather than a guess, so a call site keeps compiling and the debt
 * is NAMED rather than hidden. Every one below is a shape a contract package
 * should declare, and the day it does the entry stops being a placeholder
 * without any call site changing.
 */
// oxlint-disable-next-line no-explicit-any
type Unpublished = any;

type Q = { query: { input: Unpublished; output: Unpublished } };

/**
 * A LIST procedure, stated as a list.
 *
 * `Unpublished` is `any`, and `any` gives a `.map` callback no contextual type
 * at all, so every iteration of a placeholder result is an implicit-any error
 * under `strict`. `Unpublished[]` costs the same nothing in precision and hands
 * the callback its parameter, which is the difference between a debt that is
 * named and thirty casts that hide it.
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
    moveToFolder: M;
    restoreVersion: M;
    run: M;
    cancelJob: M;
    cancelBatchRun: M;
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
    folders: {
      getAll: QL;
      create: M;
      rename: M;
      archive: M;
    };
  };

  /**
   * THE BORROWED VOCABULARY, one segment per feature these screens reach.
   *
   * Every path is the path the call site already wrote as `api.x.y`, kept
   * letter for letter so a scenario query and the same query fired from a page
   * the application still serves land on ONE React Query cache entry.
   */
  agents: {
    getAll: QL;
    getById: Q;
    getRelatedEntities: Q;
    create: M;
    update: { mutation: { input: UpdateAgentCommand; output: AgentApiUpdateOutput } };
    delete: M;
    cascadeArchive: M;
  };
  /**
   * What the reader may do here.
   *
   * Typed rather than left `Unpublished` because `useCan` builds a
   * `ReadonlySet<string>` out of it, and a placeholder would make that a
   * `Set<unknown>` — the one place in this map where the row shape is load
   * bearing rather than merely passed through.
   */
  authz: {
    effectivePermissions: {
      query: {
        input: { projectId?: string; organizationId?: string };
        output: { permissions: string[] };
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
   *
   * Read by the frontend feature that mounts these screens rather than by a
   * screen, and declared here so it lands on the same cache entry as the
   * application shell's own read of it — one fetch for the document, however
   * many halves of the product want it.
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
