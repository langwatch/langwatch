import { z } from "zod";

export const PUBLIC_APP_CONFIG_META_NAME = "langwatch-public-config";

export const publicAppConfigSchema = z.strictObject({
  appBaseUrl: z.string().min(1),
  gatewayBaseUrl: z.string().min(1),
  deployment: z.enum(["saas", "self-hosted"]),
  demoProjectSlug: z.string().min(1).optional(),
  mode: z.enum(["development", "test", "production"]),
  telemetry: z.strictObject({
    browserTracing: z.boolean(),
    sampleRatio: z.number().min(0).max(1),
    posthog: z
      .strictObject({
        key: z.string().min(1),
        host: z.string().min(1).optional(),
      })
      .optional(),
  }),
  capabilities: z.strictObject({
    email: z.boolean(),
    nlp: z.boolean(),
    langevals: z.boolean(),
  }),
  licensePaymentUrl: z.string().min(1).optional(),
});

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;
