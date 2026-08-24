import { z } from "zod";

export const SAAS_GATEWAY_URL = "https://gateway.langwatch.ai" as const;
export const LOCAL_GATEWAY_URL = "http://localhost:5563" as const;
export const gatewayConfigurationSchema = z
  .object({
    publicUrl: z.string().url().nullable().optional(),
    baseUrl: z.string().url().nullable().optional(),
    isSaas: z.boolean().optional(),
  })
  .strict();
export type GatewayConfiguration = z.infer<typeof gatewayConfigurationSchema>;

export function resolveGatewayBaseUrl(input: GatewayConfiguration): string {
  return (
    input.publicUrl ??
    input.baseUrl ??
    (input.isSaas ? SAAS_GATEWAY_URL : LOCAL_GATEWAY_URL)
  );
}
