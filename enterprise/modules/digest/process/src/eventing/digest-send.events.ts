// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The weekly send's own facts: one person's email for one week, asked for by the week's plan. */
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const DIGEST_SEND_PIPELINE_NAME = "digest_send" as const;
export const DIGEST_SEND_AGGREGATE_TYPE = "digest_send" as const;
export const DIGEST_SEND_EVENT_VERSION = "2026-11-19" as const;
export const DIGEST_SEND_REQUESTED_EVENT_TYPE = "lw.digest.send_requested" as const;
export const REQUEST_DIGEST_SEND_COMMAND_TYPE = "lw.digest.request_send" as const;

export const digestSendRequestedEventDataSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  isoWeek: z.string().min(1),
  /**
   * For a person in several enrolled organizations, the one whose week they are sent, decided
   * once at plan time so every organization's send agrees even if the folds change in between.
   * Null when the plan ranked no home: the send then ranks the organizations itself.
   */
  homeOrganizationId: z.string().min(1).nullable(),
});
export type DigestSendRequest = z.infer<typeof digestSendRequestedEventDataSchema>;

export const DigestSendRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(DIGEST_SEND_REQUESTED_EVENT_TYPE),
  version: z.literal(DIGEST_SEND_EVENT_VERSION),
  data: digestSendRequestedEventDataSchema,
});
