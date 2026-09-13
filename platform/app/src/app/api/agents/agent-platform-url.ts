import { platformUrl } from "../shared/platform-url";

/**
 * The platform's own address for ONE agent: the agents page with the editor
 * drawer for that agent open: `agentHttpEditor` for HTTP agents,
 * `agentConnectedDetail` for connected agents, `agentCodeEditor` for the
 * rest: the same address the app's own UI produces
 * via `openDrawer(...)` (see `drawerRegistry.ts`). Shared by the agents REST
 * API and the Langy navigate fallback so the drawer choice lives in one place.
 */
export function agentPlatformUrl({
  projectSlug,
  agentId,
  agentType,
}: {
  projectSlug: string;
  agentId: string;
  agentType: string;
}): string {
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
}
