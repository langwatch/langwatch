/**
 * `evaluators.*` isn't written down: `ContractApiMap` reads the contract's
 * declaration, so a rename is a compile error, not a cache miss. Segment
 * names are load-bearing — tRPC hashes them into the query cache key.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type {
  EvaluatorCascadeArchive,
  EvaluatorRelatedEntities as EvaluatorRelatedEntitiesContract,
  evaluatorTrpc,
} from "@langwatch/evaluator-contract";

/** An evaluator and a project, the input nine of these ten procedures take. */
export type EvaluatorIdInput = { id: string; projectId: string };

/**
 * What deleting an evaluator would take with it, named before the reader
 * confirms: a linked workflow is ARCHIVED and every online evaluation
 * built on the evaluator is DELETED, neither recoverable from this screen.
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
        output: {
          id: string;
          name: string;
          teams: {
            id: string;
            name: string;
            members?: {
              userId: string;
              role: string;
              assignedRole?: { permissions?: unknown } | null;
            }[];
            projects: { id: string; name: string; slug: string }[];
          }[];
        }[];
      };
    };
  };

  licenseEnforcement: {
    /**
     * Named for its CACHE KEY alone: invalidating it keeps this seat
     * count agreeing with `platform/app`'s banner after a delete, though
     * nothing in this package reads the answer itself.
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
 * `createModuleApi` for why separate instances still share cache entries.
 */
export const evaluatorApi = createModuleApi<EvaluatorApiMap>();
