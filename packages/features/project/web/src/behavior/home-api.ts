/**
 * Procedures this package calls: derived namespaces from contract, borrowed
 * ones from features not yet split. Segment names are load-bearing for React
 * Query cache.
 */

import type { TimeseriesBucket } from "@langwatch/analytics-contract";
import type {
  homeTrpc,
  integrationsChecksTrpc,
  projectTrpc,
} from "@langwatch/project-contract";
import { createFeatureApi, type ContractApiMap } from "@langwatch/api/web";

/**
 * What kind of thing the reader touched. Restated rather than imported: a web
 * package may not name a server package, and this is the wire's vocabulary.
 */
export type RecentItemType =
  | "prompt"
  | "workflow"
  | "dataset"
  | "evaluation"
  | "annotation"
  | "simulation";

/** One thing the reader touched recently, as the home lists it. */
export type RecentItem = {
  id: string;
  type: RecentItemType;
  name: string;
  href: string;
  /** ISO 8601: the wire carries the instant as text. */
  updatedAt: string;
};

type BorrowedProcedures = {
  organization: {
    /**
     * Workspace graph narrowed to the project. THE SAME PATH AND INPUT the
     * shell asks, which under tRPC cache key is the same entry.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              firstMessage?: boolean | null;
              apiKey?: string | null;
            }>;
          }>;
        }>;
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

  analytics: {
    /**
     * Briefing's vanity strip and error line figures. Input is the shared
     * analytics filter; output is typed for series lookups.
     */
    getTimeseries: {
      query: {
        input: Record<string, unknown>;
        output: {
          previousPeriod?: TimeseriesBucket[];
          currentPeriod?: TimeseriesBucket[];
        };
      };
    };
  };

  scenarios: {
    /**
     * Simulation sets the briefing rolls up into one pass/fail line.
     */
    getExternalSetSummaries: {
      query: {
        input: { projectId: string };
        output: Array<{
          scenarioSetId: string;
          passedCount: number;
          failedCount: number;
          totalCount: number;
          lastRunTimestamp?: number | null;
        }>;
      };
    };
  };

  tracesV2: {
    /**
     * Facet value frequencies in a window. Error message shapes compared to
     * the prior period; `totalDistinct` tells whether we see the whole set.
     */
    facetValues: {
      query: {
        input: {
          projectId: string;
          timeRange: { from: number; to: number };
          facetKey: string;
          limit: number;
          offset: number;
        };
        output: {
          values: Array<{ value: string; count: number }>;
          totalDistinct: number;
        };
      };
    };
  };
};

export type HomeApiMap = ContractApiMap<typeof homeTrpc> &
  ContractApiMap<typeof integrationsChecksTrpc> &
  ContractApiMap<typeof projectTrpc> &
  BorrowedProcedures;

export const homeApi = createFeatureApi<HomeApiMap>();
