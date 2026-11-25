// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineCommand } from "@langwatch/eventing";

import { digestSendKey } from "../rules/digest-email.rules.ts";
import {
  DIGEST_SEND_AGGREGATE_TYPE,
  DIGEST_SEND_EVENT_VERSION,
  DIGEST_SEND_REQUESTED_EVENT_TYPE,
  digestSendRequestedEventDataSchema,
  REQUEST_DIGEST_SEND_COMMAND_TYPE,
} from "./digest-send.events.ts";

/**
 * Keyed by the person and week, so a plan carried out twice asks each member once. The aggregate
 * sits under the asking organization's tenant: a member of two enrolled organizations has two,
 * and the `DigestSend` claim keeps their email to one.
 */
export const RequestDigestSendCommand = defineCommand({
  commandType: REQUEST_DIGEST_SEND_COMMAND_TYPE,
  eventType: DIGEST_SEND_REQUESTED_EVENT_TYPE,
  eventVersion: DIGEST_SEND_EVENT_VERSION,
  aggregateType: DIGEST_SEND_AGGREGATE_TYPE,
  schema: digestSendRequestedEventDataSchema,
  aggregateId: digestSendKey,
  idempotencyKey: ({ organizationId, userId, isoWeek }) =>
    `${organizationId}:${digestSendKey({ userId, isoWeek })}:send_requested`,
});
