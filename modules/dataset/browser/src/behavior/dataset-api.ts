/**
 * The procedures this package calls: dataset, datasetRecord and batchRecord
 * derive from the contract, storedObjects from its owner's (ADR-158), the
 * borrowed three belong to features not yet split. Segment names are the cache key.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { batchRecordTrpc, datasetRecordTrpc, datasetTrpc } from "@langwatch/dataset-contract";
import type { storedObjectTrpc } from "@langwatch/stored-object-contract";

/**
 * Procedures other features own. Each belongs in that feature's own contract;
 * until it is split, this family states the shape it reads.
 */
type BorrowedProcedures = {
  limits: {
    /**
     * Declared for its INVALIDATION, not its answer: archiving frees usage
     * against the plan, and surfaces that render the allowance ask this
     * procedure. Nothing here renders it; the list screen just invalidates it.
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
};

/** Everything this family calls: the declared namespaces plus the borrowed three. */
export type DatasetApiMap = ContractApiMap<typeof datasetTrpc> &
  ContractApiMap<typeof datasetRecordTrpc> &
  ContractApiMap<typeof batchRecordTrpc> &
  ContractApiMap<typeof storedObjectTrpc> &
  BorrowedProcedures;

/**
 * The Datasets family's typed tRPC hooks, on the application's transport and
 * React Query cache. Internal by convention; exported from `./datasets` only
 * so the process shell can mount `datasetApi.Provider`.
 */
export const datasetApi = createModuleApi<DatasetApiMap>();
