import { z } from "zod";
import { platformToolPolicySchema } from "./platform-tool-policy";

const cliToolPolicyMapSchema = z
  .object({
    claude: platformToolPolicySchema,
    codex: platformToolPolicySchema,
    gemini: platformToolPolicySchema,
    opencode: platformToolPolicySchema,
    cursor: platformToolPolicySchema,
    copilot: platformToolPolicySchema,
    code: platformToolPolicySchema,
  })
  .strict();

export const cliBootstrapInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type CliBootstrapInput = z.infer<typeof cliBootstrapInputSchema>;

export const cliBootstrapResultSchema = z
  .object({
    tools: z.array(
      z.object({ slug: z.string().min(1), displayName: z.string().min(1) }),
    ),
    providers: z.array(
      z.object({
        name: z.string().min(1),
        displayName: z.string().min(1),
        configured: z.boolean(),
      }),
    ),
    gatewayProviders: z.array(z.string().min(1)),
    budget: z
      .object({
        monthlyLimitUsd: z.number().nullable(),
        monthlyUsedUsd: z.number(),
        period: z.literal("MONTHLY"),
      })
      .strict(),
    gatewayUrl: z.string().url(),
    adminEmail: z.string().email().nullable(),
    toolPolicies: cliToolPolicyMapSchema,
  })
  .strict();
export type CliBootstrapResult = z.infer<typeof cliBootstrapResultSchema>;

export abstract class GovernanceCliBootstrapService {
  abstract resolve(input: CliBootstrapInput): Promise<CliBootstrapResult>;
}
