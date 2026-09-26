// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  DOMAIN_PROOF_LAPSED_EVENT_TYPE,
  DOMAIN_PROOF_WAVERED_EVENT_TYPE,
} from "@langwatch/identity";
import { z } from "zod";
import type { ProcessManagerInitialStage } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  EventHandler,
  IntentContext,
  IntentSpec,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { SsoConnectionEvent } from "../schemas/events";

export const SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME =
  "ssoDomainProofNotification" as const;

const notificationBaseSchema = z.object({
  notificationId: z.string().min(1),
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
  domain: z.string().min(1),
});

const emailContentSchema = z.object({
  idempotencyKey: z.string().min(1),
  to: z.string().email(),
  subject: z.string(),
  html: z.string(),
  from: z.string(),
});

export const prepareSsoDomainProofNotificationSchema = z.discriminatedUnion(
  "kind",
  [
    notificationBaseSchema.extend({
      kind: z.literal("wavering"),
      graceEndsAtMs: z.number().int().nonnegative(),
    }),
    notificationBaseSchema.extend({
      kind: z.literal("lapsed"),
    }),
  ],
);
export type PrepareSsoDomainProofNotification = z.infer<
  typeof prepareSsoDomainProofNotificationSchema
>;

export const fanoutSsoDomainProofNotificationSchema =
  notificationBaseSchema.extend({
    kind: z.enum(["wavering", "lapsed"]),
    graceEndsAtMs: z.number().int().nonnegative().nullable(),
    deliveries: z.array(
      z.object({
        recipientUserId: z.string().min(1),
        content: emailContentSchema,
      }),
    ),
  });
export type FanoutSsoDomainProofNotification = z.infer<
  typeof fanoutSsoDomainProofNotificationSchema
>;

export const sendSsoDomainProofNotificationSchema = z.object({
  notificationId: z.string().min(1),
  organizationId: z.string().min(1),
  recipientUserId: z.string().min(1),
  content: emailContentSchema,
});
export type SendSsoDomainProofNotification = z.infer<
  typeof sendSsoDomainProofNotificationSchema
>;

export interface SsoDomainProofNotificationPort {
  prepare(payload: PrepareSsoDomainProofNotification): Promise<void>;
  fanout(payload: FanoutSsoDomainProofNotification): Promise<void>;
  send(payload: SendSsoDomainProofNotification): Promise<void>;
}

export type SsoDomainProofNotificationIntents = {
  prepare: IntentSpec<typeof prepareSsoDomainProofNotificationSchema>;
  fanout: IntentSpec<typeof fanoutSsoDomainProofNotificationSchema>;
  send: IntentSpec<typeof sendSsoDomainProofNotificationSchema>;
};

type NotificationState = Record<string, never>;

function notificationId(
  kind: PrepareSsoDomainProofNotification["kind"],
  data: {
    connectionId: string;
    domain: string;
    firstAbsentAtMs: number;
  },
): string {
  return `sso-domain-proof:${kind}:${data.connectionId}:${data.domain}:${data.firstAbsentAtMs}`;
}

export const onDomainProofWavered: EventHandler<
  NotificationState,
  Extract<
    SsoConnectionEvent,
    { type: typeof DOMAIN_PROOF_WAVERED_EVENT_TYPE }
  >["data"],
  SsoDomainProofNotificationIntents
> = (state, data, ctx) => {
  const id = notificationId("wavering", data);
  return {
    state,
    intents: [
      ctx.intents.prepare(`prepare:${id}`, {
        kind: "wavering",
        notificationId: id,
        connectionId: data.connectionId,
        organizationId: ctx.projectId,
        domain: data.domain,
        graceEndsAtMs: data.graceEndsAtMs,
      }),
    ],
  };
};

export const onDomainProofLapsed: EventHandler<
  NotificationState,
  Extract<
    SsoConnectionEvent,
    { type: typeof DOMAIN_PROOF_LAPSED_EVENT_TYPE }
  >["data"],
  SsoDomainProofNotificationIntents
> = (state, data, ctx) => {
  const id = notificationId("lapsed", data);
  return {
    state,
    intents: [
      ctx.intents.prepare(`prepare:${id}`, {
        kind: "lapsed",
        notificationId: id,
        connectionId: data.connectionId,
        organizationId: ctx.projectId,
        domain: data.domain,
      }),
    ],
  };
};

export function runPrepareSsoDomainProofNotification(
  port: SsoDomainProofNotificationPort,
) {
  return async (payload: PrepareSsoDomainProofNotification): Promise<void> => {
    await port.prepare(payload);
  };
}

export function runFanoutSsoDomainProofNotification(
  port: SsoDomainProofNotificationPort,
) {
  return async (payload: FanoutSsoDomainProofNotification): Promise<void> => {
    await port.fanout(payload);
  };
}

export function runSendSsoDomainProofNotification(
  port: SsoDomainProofNotificationPort,
) {
  return async (
    payload: SendSsoDomainProofNotification,
    _context: IntentContext,
  ): Promise<void> => {
    await port.send(payload);
  };
}

export function mountSsoDomainProofNotification(
  pm: ProcessManagerInitialStage<SsoConnectionEvent>,
  port: SsoDomainProofNotificationPort,
) {
  return pm
    .state<NotificationState>({})
    .intent(
      "prepare",
      prepareSsoDomainProofNotificationSchema,
      runPrepareSsoDomainProofNotification(port),
    )
    .intent(
      "fanout",
      fanoutSsoDomainProofNotificationSchema,
      runFanoutSsoDomainProofNotification(port),
    )
    .intent(
      "send",
      sendSsoDomainProofNotificationSchema,
      runSendSsoDomainProofNotification(port),
    )
    .on(DOMAIN_PROOF_WAVERED_EVENT_TYPE, onDomainProofWavered)
    .on(DOMAIN_PROOF_LAPSED_EVENT_TYPE, onDomainProofLapsed)
    .transient();
}
