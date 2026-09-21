import type { EventHandler, IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

export const SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME = "ssoDomainProofNotification" as const;

const notificationBaseSchema = z.object({
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
  domain: z.string().min(1),
  /** When the record was first found missing — the ceremony this mail is about. */
  firstAbsentAtMs: z.number().int().nonnegative(),
});

export const notifyProofWaveringIntentSchema = z.object({
  ...notificationBaseSchema.shape,
  /** When continued absence becomes a lapse, for the deadline the mail names. */
  graceEndsAtMs: z.number().int().nonnegative(),
});

export const notifyProofLapsedIntentSchema = notificationBaseSchema;

/**
 * Nothing is remembered between the two facts: each one says everything its
 * own mail needs, so the process stores no state and keeps no identity.
 */
export type SsoDomainProofNotificationState = Record<string, never>;

export const SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE: SsoDomainProofNotificationState = {};

export type SsoDomainProofNotificationIntents = {
  notifyWavering: IntentSpec<typeof notifyProofWaveringIntentSchema>;
  notifyLapsed: IntentSpec<typeof notifyProofLapsedIntentSchema>;
};

/**
 * Where the two notices actually reach administrators. The process decides
 * WHICH fact is worth a mail; the service behind this decides who reads it.
 */
export interface SsoDomainProofNotifications {
  proofWavering(args: {
    connectionId: string;
    organizationId: string;
    domain: string;
    graceEndsAtMs: number;
  }): Promise<void>;

  proofLapsed(args: {
    connectionId: string;
    organizationId: string;
    domain: string;
  }): Promise<void>;
}

/**
 * One key per ceremony, not per delivery attempt: a redelivered fact is the
 * same mail and collapses, while a domain that goes missing again starts a
 * new `firstAbsentAtMs` and earns a new one.
 */
function notificationKey(
  kind: "wavering" | "lapsed",
  data: { connectionId: string; domain: string; firstAbsentAtMs: number },
): string {
  return `sso-domain-proof:${kind}:${data.connectionId}:${data.domain}:${data.firstAbsentAtMs}`;
}

/**
 * The evidence has just gone missing and there is still time. Sent once, on
 * the first absence — a mail on every re-check is a mail somebody filters.
 */
export const onDomainProofWavered: EventHandler<
  SsoDomainProofNotificationState,
  { connectionId: string; domain: string; firstAbsentAtMs: number; graceEndsAtMs: number },
  SsoDomainProofNotificationIntents
> = (state, data, ctx) => ({
  state,
  intents: [
    ctx.intents.notifyWavering(notificationKey("wavering", data), {
      connectionId: data.connectionId,
      organizationId: ctx.projectId,
      domain: data.domain,
      firstAbsentAtMs: data.firstAbsentAtMs,
      graceEndsAtMs: data.graceEndsAtMs,
    }),
  ],
});

/** The grace ran out. The second and last mail about one absence. */
export const onDomainProofLapsed: EventHandler<
  SsoDomainProofNotificationState,
  { connectionId: string; domain: string; firstAbsentAtMs: number },
  SsoDomainProofNotificationIntents
> = (state, data, ctx) => ({
  state,
  intents: [
    ctx.intents.notifyLapsed(notificationKey("lapsed", data), {
      connectionId: data.connectionId,
      organizationId: ctx.projectId,
      domain: data.domain,
      firstAbsentAtMs: data.firstAbsentAtMs,
    }),
  ],
});
