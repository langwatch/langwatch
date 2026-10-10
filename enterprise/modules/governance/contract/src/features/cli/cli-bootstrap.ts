import type { Named } from "@langwatch/module";
import { z } from "zod";

import { platformToolPolicySchema } from "../../platform-tool-policy.ts";

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

const cliBootstrapInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface CliBootstrapInputSchema extends Named<typeof cliBootstrapInputSchemaDefinition> {}
export const cliBootstrapInputSchema: CliBootstrapInputSchema = cliBootstrapInputSchemaDefinition;
export type CliBootstrapInput = z.infer<typeof cliBootstrapInputSchema>;

const cliBootstrapResultSchemaDefinition = z
  .object({
    tools: z.array(z.object({ slug: z.string().min(1), displayName: z.string().min(1) })),
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
    adminEmail: z.string().nullable(),
    toolPolicies: cliToolPolicyMapSchema,
  })
  .strict();
export interface CliBootstrapResultSchema extends Named<
  typeof cliBootstrapResultSchemaDefinition
> {}
export const cliBootstrapResultSchema: CliBootstrapResultSchema =
  cliBootstrapResultSchemaDefinition;
export type CliBootstrapResult = z.infer<typeof cliBootstrapResultSchema>;
