/**
 * Procedures this package calls: derived namespaces from contract, borrowed
 * ones from features not yet split. Segment names are load-bearing for React
 * Query cache.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { homeTrpc } from "@langwatch/audit-log-contract";
import type { integrationsChecksTrpc } from "@langwatch/onboarding-contract";
import type { projectTrpc } from "@langwatch/project-contract";

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
