/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts` and `ops-api.ts` say of their own
 * maps: the procedures live in `@langwatch/agent-server`, in the enterprise
 * licensing vertical and in the process's own composition, none of which a web
 * package may import even for a type, and the router type does not exist until
 * a process instantiates it. Emitting this file from the mounted router is the
 * fix; writing it by hand is the interim, and it is honest only because every
 * payload below is `@langwatch/agent-contract`'s own.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `agents`, `licenseEnforcement` and
 * `organization` are mount points on the root router, and tRPC hashes that path
 * into the React Query cache key; spell one differently and these hooks quietly
 * stop sharing a cache with the `api.agents.*` call sites that have not moved —
 * the Agent list drawer, the scenario editor and the experiments workbench are
 * all still such call sites.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 *
 * SMALL ON PURPOSE. Only the three reads the screen renders from are declared;
 * every write the family performs travels on `AgentBrowserPort`, which the host
 * supplies and which already states each procedure's input and output against
 * the contract's schemas. Declaring them twice would be two promises about one
 * router, and only one of them would be checked.
 */

import type { AgentListView } from "@langwatch/agent-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** The project every agent procedure is scoped to. */
type ProjectScope = { projectId: string };

export type AgentApiMap = {
  agents: {
    /**
     * Every live agent in the project, newest first.
     *
     * Instants are real `Date`s: the router returns the contract value over
     * superjson rather than a JSON projection.
     */
    getAll: {
      query: { input: ProjectScope; output: AgentListView[] };
    };
  };

  licenseEnforcement: {
    /**
     * Declared for its INVALIDATION rather than its answer.
     *
     * Archiving an agent frees a seat against the plan's agent limit, and the
     * create buttons elsewhere in the product ask this procedure whether one is
     * left. Nothing in this package renders the answer; the screen invalidates
     * the entry so those buttons re-ask.
     */
    checkLimit: {
      query: {
        input: { organizationId: string; limitType: string };
        output: { exceeded: boolean };
      };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what a replication target needs.
     *
     * Read by the frontend feature that mounts this screen rather than by the
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per document
     * however many halves of the product want it. The membership columns are
     * declared because the replication picker greys out a project the reader may
     * not create in, and that answer is per TEAM rather than per current scope.
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

/**
 * The Agents family's typed tRPC hooks. Same machinery, same transport and same
 * React Query cache as the application's `api` proxy — see `createFeatureApi`
 * for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and other packages
 * call the hooks. It is exported from `screens/agent-management` only so the
 * process shell can mount `agentApi.Provider`.
 */
export const agentApi = createFeatureApi<AgentApiMap>();
