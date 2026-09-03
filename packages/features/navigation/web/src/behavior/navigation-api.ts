/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedure is mounted by the process, and the
 * router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `governance` is a mount point on the root
 * router and tRPC hashes that path into the React Query cache key; spell it
 * differently and this hook quietly stops sharing a cache with the
 * `api.governance.resolveHome` call sites that have not moved.
 *
 * The answer is `PersonaResolution` — `@langwatch/enterprise-governance-contract`'s
 * own shape, restated here rather than imported so a core web package does not
 * take an enterprise dependency to read four booleans off a wire. The four
 * fields below are the ones the landing redirect reads; the procedure answers
 * every one of them on every call, which is why `use-landing-redirect` treats
 * "answered" and "resolved" as the same thing.
 */

import type { AgentType } from "@langwatch/agent-contract";
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
     *
     * The SAME PATH AND THE SAME INPUT the application shell already asks with,
     * which under tRPC's path-plus-input cache key is the same entry: the graph
     * is fetched once for the document however many halves of the product want
     * it. `members` is narrowed by the procedure to the caller's own row, which
     * is what makes reading a role off `members[0]` correct here.
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
             * Whose personal workspace a personal team is.
             *
             * A `Team` column the procedure already returns; the chrome reads
             * it to tell the reader's own workspace from somebody else's,
             * opened with administrative reach.
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
     * Records that an administrator opened somebody else's workspace.
     *
     * The shell's page body fires it once per project the administrator drills
     * into, which is the only place the product knows a cross-scope read
     * happened at all. Fail-quiet on the client: a refused emission must not
     * stop the page rendering.
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
     *
     * THE SAME PATH AND INPUT the application shell asks with, so the sidebar
     * meter, the shell's limit banners and `apps/ui`'s own plan read all land
     * on one cache entry rather than three requests for one answer.
     *
     * `currentMonthMessagesCount` is null on unlimited and legacy answers,
     * which is why the meter reads it before dividing by anything.
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
     * Which library entries the reader unlocked in their personal workspace.
     *
     * Default-empty rather than default-on: an existing reader sees Traces
     * alone until the bundle is turned on in `/me/configure`.
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
     * One flag, answered for several organizations at once.
     *
     * The organization switch needs the TARGET organization's reachable
     * products before it can pick a landing address, and a per-organization
     * flag read is the only gate resolvable from the top bar.
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
   * THE FIVE LISTS QUICK SEARCH READS, and the reason the command bar is not a
   * feature of its own.
   *
   * Every one of them is another family's list query, asked at the family's own
   * path and input so the answer is the same React Query entry that family's own
   * page fills — the way `limits.getUsage` above is one entry shared with the
   * sidebar meter. The palette owns no procedure at all; it owns a catalogue and
   * a ranking. That is what put it here, in the package whose shell renders it,
   * rather than in a package of its own.
   *
   * Each is asked only while the palette is open and a project is resolved,
   * which is what keeps a Cmd+K on a settings page from firing five requests.
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
     *
     * `type` was narrowed out of this map, and the cost was a dead link: with
     * only an id and a name, the palette wrote `?drawer.open=agentViewer` — a
     * name that has never been in any drawer registry and has never had a
     * component — so every agent hit in the command bar opened nothing at all.
     * The server has always answered the type; see `agentEditorDrawerForType`
     * for what it decides.
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
};

export const navigationApi = createFeatureApi<NavigationApiMap>();
