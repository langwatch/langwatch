/**
 * Zod schema for `AnomalyRule.destinationConfig` — the C3 alert
 * dispatch payload that fans out fired AnomalyAlerts to external
 * targets (SIEM / on-call / Slack via incoming-webhook / etc.).
 *
 * Mirrors the threshold-config strict-validation pattern from
 * `thresholdConfig.schema.ts:1f4ddd04c`: validate at create/update
 * + safeParse at dispatch time so legacy rows are quarantined
 * (skip + warn) instead of silently defaulting.
 *
 * MVP shape — webhook only:
 *
 *   {
 *     destinations: [
 *       { type: "webhook", url: "https://hooks.example.com/lw",
 *         sharedSecret?: "S3CR3T" }
 *     ]
 *   }
 *
 * `sharedSecret`, when present, drives HMAC-SHA256(body) →
 * X-LangWatch-Signature header so receivers can verify the request
 * came from us.
 *
 * Slack / PagerDuty / email / DLQ are deferred to follow-up rows.
 * Webhook is the universal escape hatch — point it at a Slack
 * incoming-webhook URL with a small adapter on the receiver side.
 *
 * Spec: specs/ai-gateway/governance/c3-alert-dispatch.feature
 */
import { z } from "zod";

export const SUPPORTED_DESTINATION_TYPES = ["webhook"] as const;
export type SupportedDestinationType =
  (typeof SUPPORTED_DESTINATION_TYPES)[number];

export const webhookDestinationSchema = z.object({
  type: z.literal("webhook"),
  url: z
    .string()
    .url({ message: "url must be an absolute http(s) URL" })
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "url must use http or https scheme",
    }),
  sharedSecret: z.string().min(1).max(512).optional(),
});
export type WebhookDestination = z.infer<typeof webhookDestinationSchema>;

const destinationSchema = z.discriminatedUnion("type", [
  webhookDestinationSchema,
]);
export type Destination = z.infer<typeof destinationSchema>;

export const destinationConfigSchema = z.object({
  destinations: z.array(destinationSchema).max(10),
});
export type DestinationConfigParsed = z.infer<typeof destinationConfigSchema>;

/**
 * Strict validator. Throws ZodError on shape failure. Used at
 * create/update time so admins see misconfigurations immediately.
 */
export function validateDestinationConfig(
  config: unknown,
): DestinationConfigParsed {
  return destinationConfigSchema.parse(config);
}

/**
 * Safe-parse flavor used by the dispatcher to quarantine legacy
 * rows whose destinationConfig pre-dates the schema. Returns
 * `{ ok: false }` instead of throwing so the evaluator can log +
 * fall back to log-only without crashing the whole job tick.
 */
export function safeParseDestinationConfig(
  config: unknown,
):
  | { ok: true; data: DestinationConfigParsed }
  | { ok: false; error: z.ZodError } {
  // Common case: empty/missing config means "no destinations" — that's
  // explicit log-only behavior, not a validation failure.
  if (!config || (typeof config === "object" && Object.keys(config).length === 0)) {
    return { ok: true, data: { destinations: [] } };
  }
  const result = destinationConfigSchema.safeParse(config);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error };
}
