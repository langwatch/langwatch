import type { PlatformUrlBuilder } from "@langwatch/api/rest";
import type { AgentPlatformUrlBuilder } from "@langwatch/agent-server";

/**
 * The platform's own address for ONE agent: the agents page with the editor
 * drawer for that agent open: `agentHttpEditor` for HTTP agents,
 * `agentConnectedDetail` for connected agents, `agentCodeEditor` for the
 * rest: the same address the app's own UI produces via `openDrawer(...)` (see
 * `drawerRegistry.ts`). Shared by the agents REST API and the Langy navigate
 * fallback so the drawer choice lives in one place.
 *
 * A factory over the process's own {@link PlatformUrlBuilder} rather than a
 * module-level function reading an environment module: the deployment's public
 * origin is the composition's, and a second reading of it would let two doors
 * publish two addresses for one agent.
 */
export function createAgentPlatformUrlBuilder(
  platformUrl: PlatformUrlBuilder,
): AgentPlatformUrlBuilder {
  return ({ projectSlug, agentId, agentType }) => {
    const drawer =
      agentType === "http"
        ? "agentHttpEditor"
        : agentType === "connected"
          ? "agentConnectedDetail"
          : "agentCodeEditor";
    return platformUrl({
      projectSlug,
      path: `/agents?drawer.open=${drawer}&drawer.agentId=${encodeURIComponent(agentId)}`,
    });
  };
}
