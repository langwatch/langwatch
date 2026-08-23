import { z } from "zod";
import { codeAgentConfigSchema } from "./code";
import { httpAgentConfigSchema } from "./http";
import { signatureAgentConfigSchema } from "./signature";
import { workflowAgentConfigSchema } from "./workflow";

export * from "./base";
export * from "./code";
export * from "./http";
export * from "./signature";
export * from "./workflow";

export const agentTypeSchema = z.enum([
  "signature",
  "code",
  "workflow",
  "http",
]);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const agentConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  z.object({ type: z.literal("code"), config: codeAgentConfigSchema }),
  z.object({ type: z.literal("workflow"), config: workflowAgentConfigSchema }),
  z.object({ type: z.literal("http"), config: httpAgentConfigSchema }),
]);

export type AgentConfig =
  | z.infer<typeof signatureAgentConfigSchema>
  | z.infer<typeof codeAgentConfigSchema>
  | z.infer<typeof workflowAgentConfigSchema>
  | z.infer<typeof httpAgentConfigSchema>;

export function parseAgentConfig(
  type: AgentType,
  config: unknown,
): AgentConfig {
  switch (type) {
    case "signature":
      return signatureAgentConfigSchema.parse(config);
    case "code":
      return codeAgentConfigSchema.parse(config);
    case "workflow":
      return workflowAgentConfigSchema.parse(config);
    case "http":
      return httpAgentConfigSchema.parse(config);
  }
}
