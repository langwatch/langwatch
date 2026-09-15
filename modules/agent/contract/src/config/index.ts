import { z } from "zod";
import { codeAgentConfigSchema } from "./code.ts";
import { connectedAgentConfigSchema } from "./connected.ts";
import { httpAgentConfigSchema } from "./http.ts";
import { signatureAgentConfigSchema } from "./signature.ts";
import { workflowAgentConfigSchema } from "./workflow.ts";

export * from "./base.ts";
export * from "./code.ts";
export * from "./connected.ts";
export * from "./http.ts";
export * from "./signature.ts";
export * from "./workflow.ts";

/**
 * The kinds of agent a project can hold: the four studio component types,
 * plus `connected` — an agent the SDK registered from a decorated function in
 * the customer's own code (ADR-128).
 */
export const agentTypeSchema = z.enum(["signature", "code", "workflow", "http", "connected"]);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const agentConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  z.object({ type: z.literal("code"), config: codeAgentConfigSchema }),
  z.object({ type: z.literal("workflow"), config: workflowAgentConfigSchema }),
  z.object({ type: z.literal("http"), config: httpAgentConfigSchema }),
  z.object({ type: z.literal("connected"), config: connectedAgentConfigSchema }),
]);

export type AgentConfig =
  | z.infer<typeof signatureAgentConfigSchema>
  | z.infer<typeof codeAgentConfigSchema>
  | z.infer<typeof workflowAgentConfigSchema>
  | z.infer<typeof httpAgentConfigSchema>
  | z.infer<typeof connectedAgentConfigSchema>;

export function parseAgentConfig(type: AgentType, config: unknown): AgentConfig {
  switch (type) {
    case "signature":
      return signatureAgentConfigSchema.parse(config);
    case "code":
      return codeAgentConfigSchema.parse(config);
    case "workflow":
      return workflowAgentConfigSchema.parse(config);
    case "http":
      return httpAgentConfigSchema.parse(config);
    case "connected":
      return connectedAgentConfigSchema.parse(config);
  }
}
