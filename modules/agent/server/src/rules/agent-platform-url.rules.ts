/**
 * Deep link to one agent's editor drawer. Computed locally because the
 * REST declaration is static and can't receive a request-scoped builder.
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
