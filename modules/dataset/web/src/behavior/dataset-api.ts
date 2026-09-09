/**
 * The procedures this package calls: dataset, datasetRecord and batchRecord
 * derive from the contract, the borrowed three belong to features not yet
 * split. Segment names are load-bearing (React Query cache key).
 */

import type { batchRecordTrpc, datasetRecordTrpc, datasetTrpc } from "@langwatch/dataset-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

/**
 * Procedures other features own. Each belongs in that feature's own contract;
 * until it is split, this family states the shape it reads.
 */
type BorrowedProcedures = {
  limits: {
    /**
     * Declared for its INVALIDATION rather than its answer.
     *
     * Archiving a dataset frees usage against the plan, and the surfaces that
     * render the allowance ask this procedure. Nothing in this package renders
     * it; the list screen invalidates the entry so those surfaces re-ask.
     */
    getUsage: {
      query: {
        input: { organizationId: string };
        output: unknown;
      };
    };
  };

  licenseEnforcement: {
    /** Declared for its invalidation, exactly as `limits.getUsage` above. */
    checkLimit: {
      query: {
        input: { organizationId: string; limitType: string };
        output: { exceeded: boolean };
      };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what a replication target needs;
     * shares the application shell's cache entry and is read per TEAM, since
     * the picker offers only projects the reader may create in.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
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
};

/** Everything this family calls: the declared namespaces plus the borrowed three. */
export type DatasetApiMap = ContractApiMap<typeof datasetTrpc> &
  ContractApiMap<typeof datasetRecordTrpc> &
  ContractApiMap<typeof batchRecordTrpc> &
  BorrowedProcedures;

/**
 * The Datasets family's typed tRPC hooks, on the application's transport and
 * React Query cache. Internal by convention; exported from `./datasets` only
 * so the process shell can mount `datasetApi.Provider`.
 */
export const datasetApi = createModuleApi<DatasetApiMap>();
