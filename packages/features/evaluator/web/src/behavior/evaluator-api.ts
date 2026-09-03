/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/evaluator-server`, which a web package may not import even for a
 * type, and the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `evaluators` and `licenseEnforcement` are
 * mount points on the root router and tRPC hashes that path into the React
 * Query cache key; spell either differently and these hooks quietly stop
 * sharing a cache with the `api.evaluators.*` call sites that have NOT moved —
 * of which there are many, every evaluator drawer among them.
 *
 * `Evaluator`, `EvaluatorCopy` and `EvaluatorHistoryEntry` ARE THE PRODUCER'S
 * OWN TYPES, not restatements: `@langwatch/evaluator-contract` declares all
 * three and `EvaluatorService` is annotated with them, so widening what a read
 * answers is a compile error at the producer rather than a silent surprise at
 * this grid.
 *
 * `licenseEnforcement.checkLimit` is `@langwatch/enterprise-licensing-server`'s
 * and is named here ONLY as a string, for the invalidation the delete performs.
 * A procedure PATH is free; an enterprise TYPE would not be — the S7 ruling,
 * applied for the third time.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type {
  Evaluator,
  EvaluatorCopy,
  EvaluatorHistoryEntry,
} from "@langwatch/evaluator-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** An evaluator and a project, the input nine of these ten procedures take. */
export type EvaluatorIdInput = { id: string; projectId: string };

/**
 * What deleting an evaluator would take with it.
 *
 * The confirmation names both lists BEFORE the reader types "delete", which is
 * the whole reason the read exists: a linked workflow is ARCHIVED and every
 * online evaluation built on the evaluator is DELETED, and neither is
 * recoverable from this screen.
 */
export type EvaluatorRelatedEntities = {
  workflow: { id: string; name: string } | null;
  monitors: { id: string; name: string }[];
};

/** What the cascade actually did, which is what the confirmation reports back. */
export type EvaluatorCascadeArchiveResult = {
  archivedWorkflow: { id: string; name: string } | null;
  deletedMonitorsCount: number;
};

export type EvaluatorApiMap = {
  evaluators: {
    /** Every evaluator in the project, newest edit first. */
    getAll: {
      query: { input: { projectId: string }; output: Evaluator[] };
    };

    /**
     * The workflow and online evaluations a delete would take with it.
     *
     * Asked only while the confirmation is open — the answer is what the
     * dialog's warning is built from, and asking for every card would be a
     * fan-out proportional to the grid.
     */
    getRelatedEntities: {
      query: { input: EvaluatorIdInput; output: EvaluatorRelatedEntities };
    };

    /** Archives an evaluator that nothing else depends on. */
    delete: {
      mutation: { input: EvaluatorIdInput; output: unknown };
    };

    /** Archives an evaluator, its workflow, and the online evaluations on it. */
    cascadeArchive: {
      mutation: { input: EvaluatorIdInput; output: EvaluatorCascadeArchiveResult };
    };

    /** Pulls a replica back in line with the evaluator it was copied from. */
    syncFromSource: {
      mutation: {
        input: { projectId: string; evaluatorId: string };
        output: { ok: true };
      };
    };

    /** Replicates an evaluator into another project. */
    copy: {
      mutation: {
        input: { evaluatorId: string; projectId: string; sourceProjectId: string };
        output: unknown;
      };
    };

    /** The replicas of this evaluator the reader is allowed to see. */
    getCopies: {
      query: {
        input: { evaluatorId: string; projectId: string };
        output: EvaluatorCopy[];
      };
    };

    /** Pushes this evaluator's configuration onto the chosen replicas. */
    pushToCopies: {
      mutation: {
        input: { evaluatorId: string; projectId: string; copyIds: string[] };
        output: { pushedTo: number; selectedCopies: number };
      };
    };

    /** Who changed this evaluator, and when. */
    getHistory: {
      query: {
        input: { evaluatorId: string; projectId: string };
        output: EvaluatorHistoryEntry[];
      };
    };
  };

  organization: {
    /**
     * The organization graph the application shell already holds.
     *
     * Asked by the FRONTEND FEATURE rather than by the screen — the screen is
     * handed the project and the replication targets through its host port —
     * and declared here because that feature runs on this package's transport.
     * Same input the shell asks with, so under tRPC's path-plus-input cache key
     * it is the same entry: the graph is fetched once for the document.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            id: string;
            name: string;
            members?: Array<{
              userId: string;
              role: string;
              assignedRole?: { permissions?: unknown } | null;
            }>;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };
  };

  licenseEnforcement: {
    /**
     * Named for its CACHE KEY alone.
     *
     * Deleting an evaluator frees a seat against the plan's limit, and the
     * banner that reports that limit is `platform/app`'s. Invalidating the
     * entry is what keeps the two halves agreeing while the page is split
     * across packages; nothing in this package reads the answer.
     */
    checkLimit: {
      query: { input: { projectId: string }; output: unknown };
    };
  };
};

/**
 * The evaluator family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const evaluatorApi = createFeatureApi<EvaluatorApiMap>();
