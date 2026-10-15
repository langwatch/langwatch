/**
 * Procedures this package calls: derived namespaces from contract, borrowed
 * ones from features not yet split. Segment names are load-bearing for React
 * Query cache.
 */

import { createModuleApi, type ContractApiMap, type WireOf } from "@langwatch/api/web";
import type {
  homeTrpc,
  RecentItem as ContractRecentItem,
  RecentItemType,
} from "@langwatch/audit-log-contract";
import type { integrationsChecksTrpc } from "@langwatch/onboarding-contract";
import type { projectTrpc } from "@langwatch/project-contract";

/** One thing the reader touched recently, as the home lists it: `updatedAt` arrives as ISO text. */
export type RecentItem = WireOf<ContractRecentItem>;
export type { RecentItemType };

type BorrowedProcedures = {
  organization: {
    /**
     * Workspace graph narrowed to the project. THE SAME PATH AND INPUT the
     * shell asks, which under tRPC cache key is the same entry.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: {
          id: string;
          name: string;
          teams: {
            projects: {
              id: string;
              name: string;
              slug: string;
              firstMessage?: boolean | null;
            }[];
          }[];
        }[];
      };
    };
  };

  plan: {
    /**
     * The organization's plan. "Considering LangWatch?" is offered to free
     * orgs only; a paying customer watching it is a wiring bug.
     */
    getActivePlan: {
      query: {
        input: { organizationId: string };
        output: { free: boolean; type?: string };
      };
    };
  };
};

export type HomeApiMap = ContractApiMap<typeof homeTrpc> &
  ContractApiMap<typeof integrationsChecksTrpc> &
  ContractApiMap<typeof projectTrpc> &
  BorrowedProcedures;

export const homeApi = createModuleApi<HomeApiMap>();
