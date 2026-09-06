/**
 * The procedures this package calls, and the hooks that call them.
 * Hand-written until the mounted router can generate it (ADR-130). The
 * segment names are load-bearing tRPC cache keys — renaming one stops
 * sharing a cache with `api.agents.*` call sites that have not moved.
 */

import type { AgentListView } from "@langwatch/agent-contract";
import { createFeatureApi } from "@langwatch/platform-api-client/feature-api";

/** The project every agent procedure is scoped to. */
type ProjectScope = { projectId: string };

export type AgentApiMap = {
  agents: {
    /**
     * Every live agent in the project, newest first.
     *
     * Instants are ISO 8601 strings: the router returns the contract value
     * and plain JSON is what carries it.
     */
    getAll: {
      query: { input: ProjectScope; output: AgentListView[] };
    };
  };

  licenseEnforcement: {
    /**
     * Declared for its invalidation, not its answer: archiving an agent frees
     * a plan seat, and this package invalidates the entry so the create
     * buttons elsewhere that ask it re-check, without rendering it here.
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
     * Declared here (not by the screen) so it shares the shell's own cache
     * entry. Membership is per team, not per current scope, because the
     * replication picker greys out projects the reader may not create in.
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
 * The Agents family's typed tRPC hooks. Internal by convention — hooks here
 * call it, other packages call the hooks. Exported only so
 * `screens/agent-management` can mount `agentApi.Provider`.
 */
export const agentApi = createFeatureApi<AgentApiMap>();
