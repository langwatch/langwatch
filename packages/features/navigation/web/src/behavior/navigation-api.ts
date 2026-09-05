/**
 * The procedures this package calls, and the hooks that call them. HAND-WRITTEN FOR NOW, MEANT
 * TO BE GENERATED, exactly as every other feature family's map says of itself: the procedure is
 * mounted by the process, and the router type does not exist until a process instantiates one.
 */

import type { AgentType } from "@langwatch/agent-contract";
import type { OpsApiGetBadgeCountsOutput } from "@langwatch/ops-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

export type NavigationHomeResolution = {
  destination: string;
  isOverride: boolean;
  intentPinned: boolean;
  governanceUiEnabled: boolean;
};

export type NavigationApiMap = {
  organization: {
    /**
     * The workspace graph the switcher offers and the landing decision reads.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          slug: string;
          members?: Array<{ role: string }>;
          teams: Array<{
            id: string;
            name: string;
            isPersonal?: boolean | null;
            /**
             * Whose personal workspace a personal team is. A `Team` column the procedure
             * already returns; the chrome reads it to tell the reader's own workspace from
             * somebody else's, opened with administrative reach.
             */
            ownerUserId?: string | null;
            members?: Array<{ userId: string }>;
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              /**
               * `Project` columns the procedure already returns. The project
               * column offers a Sessions and a Pull requests destination only
               * while these are recent (`coding-agent-activity`).
               */
              lastCodingAgentSessionAt?: string | Date | null;
              lastCodingAgentPullRequestAt?: string | Date | null;
            }>;
          }>;
        }>;
      };
    };
  };

  governance: {
    /** Which `/` destination the authenticated reader lands on. */
    resolveHome: {
      query: {
        input: { organizationId: string };
        output: NavigationHomeResolution;
      };
    };

    /**
     * Records that an administrator opened somebody else's workspace. The shell's page body
     * fires it once per project the administrator drills into, which is the only place the
     * product knows a cross-scope read happened at all.
     */
    recordWorkspaceView: {
      mutation: {
        input: {
          organizationId: string;
          targetTeamId: string;
          kind: "personal";
          workspaceLabel: string;
        };
        output: unknown;
      };
    };
  };

  limits: {
    /**
     * The organization's plan and what it has spent this month.
     */
    getUsage: {
      query: {
        input: { organizationId: string };
        output: {
          activePlan: {
            type?: string;
            free: boolean;
            maxMessagesPerMonth: number;
          };
          currentMonthMessagesCount: number | null;
          currentMonthCost: number;
          maxMonthlyUsageLimit: number;
          usageUnit?: string;
          messageLimitInfo?: { status: string; message: string };
        };
      };
    };
  };

  annotation: {
    /** The badge on the Annotations entry: how many items still want a look. */
    getPendingItemsCount: {
      query: { input: { projectId: string }; output: number };
    };
  };

  personalWorkspaceFeatures: {
    /**
     * Which library entries the reader unlocked in their personal workspace. Default-empty
     * rather than default-on: an existing reader sees Traces alone until the bundle is turned
     * on in `/me/configure`.
     */
    get: {
      query: {
        input: { projectId: string };
        output: {
          evaluations?: boolean;
          datasets?: boolean;
          annotations?: boolean;
          automations?: boolean;
        };
      };
    };
  };

  featureFlag: {
    /**
     * One flag, answered for several organizations at once. The organization switch needs the
     * TARGET organization's reachable products before it can pick a landing address, and a
     * per-organization flag read is the only gate resolvable from the top bar.
     */
    isEnabledForEachOrganization: {
      query: {
        input: { flag: string; organizationIds: string[] };
        output: { enabledByOrganizationId?: Record<string, boolean> };
      };
    };
  };

  user: {
    /** Whether the reader still owes their organization an SSO link. */
    getSsoStatus: {
      query: { input: Record<string, never>; output: { pendingSsoSetup?: boolean } };
    };
  };

  /**
   * THE FIVE LISTS QUICK SEARCH READS, and the reason the command bar is not a feature of its
   * own.
   */
  prompts: {
    getAllPromptsForProject: {
      query: {
        input: { projectId: string };
        output: Array<{ id: string; handle?: string | null; version?: number }>;
      };
    };
  };

  agents: {
    /**
     * Every agent in the project, with the one field that decides its address.
     */
    getAll: {
      query: {
        input: { projectId: string };
        output: Array<{ id: string; name: string; type: AgentType }>;
      };
    };
  };

  dataset: {
    getAll: {
      query: { input: { projectId: string }; output: Array<{ id: string; name: string }> };
    };
  };

  workflow: {
    getAll: {
      query: { input: { projectId: string }; output: Array<{ id: string; name: string }> };
    };
  };

  evaluators: {
    getAll: {
      query: { input: { projectId: string }; output: Array<{ id: string; name: string }> };
    };
  };

  ops: {
    /**
     * The operations attention badge: blocked groups plus dead-lettered jobs. THE SEGMENT NAME
     * IS LOAD-BEARING here for a second reason.
     * ADR-004 seals a frontend feature off from another feature's web package:
     */
    getBadgeCounts: {
      query: { input: undefined; output: OpsApiGetBadgeCountsOutput };
    };
  };
};

export const navigationApi = createFeatureApi<NavigationApiMap>();
