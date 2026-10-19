import { z } from "zod";

const agentConfigSchema = z.object({ devTunnel: z.unknown().optional() });

export function agentHasDevTunnel(agent: { type: string; config?: unknown }): boolean {
  if (agent.type !== "http") return false;

  const parsed = agentConfigSchema.safeParse(agent.config);
  return parsed.success && Boolean(parsed.data.devTunnel);
}
