/**
 * The platform's own deep link back to ONE agent, built from the app's own
 * `publicBaseUrl` config: the agents page with the editor drawer for that
 * agent open. `apps/api/src/features/agent/agent-platform-url.ts` computes
 * the same drawer path for Langy's navigate fallback, over the process's
 * shared `PlatformUrlBuilder`; this copy exists because the REST declaration
 * is a static, module-load-time object with no request-scoped builder to
 * receive, so the app composes the link itself from config it already holds.
 */
const AGENT_DRAWER_BY_TYPE: Record<string, string> = {
  http: "agentHttpEditor",
  connected: "agentConnectedDetail",
};

function agentDrawerPath({ agentId, agentType }: { agentId: string; agentType: string }): string {
  const drawer = AGENT_DRAWER_BY_TYPE[agentType] ?? "agentCodeEditor";
  return `/agents?drawer.open=${drawer}&drawer.agentId=${encodeURIComponent(agentId)}`;
}

/** `${publicBaseUrl}/${projectSlug}${agentDrawerPath}`, trailing slash trimmed. */
export function agentPlatformUrl({
  publicBaseUrl,
  projectSlug,
  agentId,
  agentType,
}: {
  publicBaseUrl: string;
  projectSlug: string;
  agentId: string;
  agentType: string;
}): string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  const path = agentDrawerPath({ agentId, agentType });

  return `${base}/${projectSlug}${path}`;
}
