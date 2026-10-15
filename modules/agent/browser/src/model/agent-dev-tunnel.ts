export function agentHasDevTunnel(agent: { type: string; config?: unknown }): boolean {
  if (agent.type !== "http") return false;
  const config = agent.config;
  return Boolean(
    config &&
    typeof config === "object" &&
    "devTunnel" in config &&
    (config as { devTunnel?: unknown }).devTunnel,
  );
}
