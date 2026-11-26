// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The weekly send's own facts: one person's email for one week of one organization, asked for by the week's plan. */
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const DIGEST_SEND_PIPELINE_NAME = "digest_send" as const;
export const DIGEST_SEND_AGGREGATE_TYPE = "digest_send" as const;
export const DIGEST_SEND_EVENT_VERSION = "2026-11-19" as const;
export const DIGEST_SEND_REQUESTED_EVENT_TYPE = "lw.digest.send_requested" as const;
export const REQUEST_DIGEST_SEND_COMMAND_TYPE = "lw.digest.request_send" as const;
export const DIGEST_ORGANIZATION_PLAN_REQUESTED_EVENT_TYPE =
  "lw.digest.organization_plan_requested" as const;
export const REQUEST_DIGEST_ORGANIZATION_PLAN_COMMAND_TYPE =
  "lw.digest.request_organization_plan" as const;

export const digestSendRequestedEventDataSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  isoWeek: z.string().min(1),
});
export type DigestSendRequest = z.infer<typeof digestSendRequestedEventDataSchema>;

export const DigestSendRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DIGEST_SEND_REQUESTED_EVENT_TYPE),
  version: z.literal(DIGEST_SEND_EVENT_VERSION),
  data: digestSendRequestedEventDataSchema,
});

/** One organization's week to plan: its own intent, so a slow or failing one holds up no other. */
export const digestOrganizationPlanRequestedEventDataSchema = z.object({
  organizationId: z.string().min(1),
  isoWeek: z.string().min(1),
});
export type DigestOrganizationPlanRequest = z.infer<
  typeof digestOrganizationPlanRequestedEventDataSchema
>;

export const DigestOrganizationPlanRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DIGEST_ORGANIZATION_PLAN_REQUESTED_EVENT_TYPE),
  version: z.literal(DIGEST_SEND_EVENT_VERSION),
  data: digestOrganizationPlanRequestedEventDataSchema,
});
