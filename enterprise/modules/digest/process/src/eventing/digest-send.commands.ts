// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineCommand } from "@langwatch/eventing";

import { digestSendKey } from "../rules/digest-email.rules.ts";
import {
  DIGEST_ORGANIZATION_PLAN_REQUESTED_EVENT_TYPE,
  DIGEST_SEND_AGGREGATE_TYPE,
  digestOrganizationPlanRequestedEventDataSchema,
  DIGEST_SEND_EVENT_VERSION,
  DIGEST_SEND_REQUESTED_EVENT_TYPE,
  digestSendRequestedEventDataSchema,
  REQUEST_DIGEST_ORGANIZATION_PLAN_COMMAND_TYPE,
  REQUEST_DIGEST_SEND_COMMAND_TYPE,
} from "./digest-send.events.ts";

/**
 * Keyed by the person, organization and week, so a plan carried out twice asks each member of
 * each organization once. A member of two organizations has two aggregates and two emails.
 */
export const RequestDigestSendCommand = defineCommand({
  commandType: REQUEST_DIGEST_SEND_COMMAND_TYPE,
  eventType: DIGEST_SEND_REQUESTED_EVENT_TYPE,
  eventVersion: DIGEST_SEND_EVENT_VERSION,
  aggregateType: DIGEST_SEND_AGGREGATE_TYPE,
  schema: digestSendRequestedEventDataSchema,
  aggregateId: digestSendKey,
  idempotencyKey: (request) => `${digestSendKey(request)}:send_requested`,
});

/** Keyed by organization and week, so a plan asked twice plans each organization once. */
export const RequestDigestOrganizationPlanCommand = defineCommand({
  commandType: REQUEST_DIGEST_ORGANIZATION_PLAN_COMMAND_TYPE,
  eventType: DIGEST_ORGANIZATION_PLAN_REQUESTED_EVENT_TYPE,
  eventVersion: DIGEST_SEND_EVENT_VERSION,
  aggregateType: DIGEST_SEND_AGGREGATE_TYPE,
  schema: digestOrganizationPlanRequestedEventDataSchema,
  aggregateId: (request) => `plan:${request.organizationId}:${request.isoWeek}`,
  idempotencyKey: (request) => `plan:${request.organizationId}:${request.isoWeek}:plan_requested`,
});
