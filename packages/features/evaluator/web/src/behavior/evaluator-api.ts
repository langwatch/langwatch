/**
 * The procedures this package calls, and the hooks that call them.
 * `evaluators.*` is not written down: `ContractApiMap` reads the contract's own
 * declaration, so a rename is a compile error rather than a silent cache miss.
 * The segment names are load-bearing — tRPC hashes them into the query cache
 * key, so a different spelling stops sharing a cache with `api.evaluators.*`.
 */

import { createFeatureApi, type ContractApiMap } from "@langwatch/api/web";
import type {
  EvaluatorCascadeArchive,
  EvaluatorRelatedEntities as EvaluatorRelatedEntitiesContract,
  evaluatorTrpc,
} from "@langwatch/evaluator-contract";

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
export type EvaluatorRelatedEntities = EvaluatorRelatedEntitiesContract;

/** What the cascade actually did, which is what the confirmation reports back. */
export type EvaluatorCascadeArchiveResult = EvaluatorCascadeArchive;

/** The namespaces this family borrows, which no evaluator contract declares. */
type BorrowedProcedures = {
  organization: {
    /**
     * The organization graph the application shell already holds. Asked by the
     * frontend feature, not the screen, with the input the shell asks with — so
     * under tRPC's cache key the graph is fetched once for the document.
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

/** Everything this family calls: the declared namespace plus the borrowed two. */
export type EvaluatorApiMap = ContractApiMap<typeof evaluatorTrpc> & BorrowedProcedures;

/**
 * The evaluator family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const evaluatorApi = createFeatureApi<EvaluatorApiMap>();
