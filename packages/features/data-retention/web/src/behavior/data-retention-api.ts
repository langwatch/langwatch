/**
 * The procedures this package calls, and the hooks that call them.
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * The `dataRetention` namespace is derived from the contract's declaration.
 */

import { createFeatureApi, type ContractApiMap } from "@langwatch/api/web";
import type { dataRetentionTrpc } from "@langwatch/data-retention-contract";

/**
 * Procedures another feature owns. The organization graph is what the scope
 * FILTER offers, narrowed to the three fields it renders.
 */
type BorrowedProcedures = {
  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            id: string;
            name: string;
            projects: Array<{ id: string; name: string }>;
          }>;
        }>;
      };
    };
  };
};

export type DataRetentionApiMap = ContractApiMap<typeof dataRetentionTrpc> & BorrowedProcedures;

/**
 * The Data Retention family's typed tRPC hooks. Same machinery, same transport and same React
 * Query cache as the application's `api` proxy — see `createFeatureApi` for why separate
 * instances still share cache entries.
 */
export const dataRetentionApi = createFeatureApi<DataRetentionApiMap>();
