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
  /**
   * Whether this deployment mounted the passkey plugin at boot. A derived
   * boolean rather than the raw setting, because the only thing a browser may
   * act on is "is there an endpoint behind the button".
   */
  passkeys: z.boolean(),
  /**
   * Whether the identifier-first screens are the front door on this
   * deployment (ADR-117 §7). Derived rather than the flag's value: the router
   * also runs in shadow, and the screens never render then.
   */
  identityFrontDoor: z.boolean(),
  licensePaymentUrl: z.string().min(1).optional(),
});

export type PublicAppConfig = z.infer<typeof publicAppConfigSchema>;
