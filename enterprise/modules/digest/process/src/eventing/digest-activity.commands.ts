// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  DIGEST_EVENT_VERSION,
  DIGEST_WEEK_AGGREGATE_TYPE,
  PROJECT_ACTIVITY_RECORDED_EVENT_TYPE,
  type ProjectActivity,
  type ProjectActivityRecordedEvent,
  projectActivitySchema,
  projectWeekKey,
  RECORD_PROJECT_ACTIVITY_COMMAND_TYPE,
  RECORD_USER_ACTIVITY_COMMAND_TYPE,
  USER_ACTIVITY_RECORDED_EVENT_TYPE,
  type UserActivity,
  type UserActivityRecordedEvent,
  userActivitySchema,
  userWeekKey,
} from "./digest-activity.events.ts";

/** One owner fact on a project's week; keyed by its source, so a redelivery appends once. */
export class RecordProjectActivityCommand implements CommandHandler<
  Command<ProjectActivity>,
  ProjectActivityRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROJECT_ACTIVITY_COMMAND_TYPE,
    projectActivitySchema,
    "Fold one owner fact into a project's digest week",
  );

  handle(command: Command<ProjectActivity>): ProjectActivityRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ProjectActivityRecordedEvent>({
        aggregateType: DIGEST_WEEK_AGGREGATE_TYPE,
        aggregateId: projectWeekKey(data),
        tenantId: createTenantId(command.tenantId),
        type: PROJECT_ACTIVITY_RECORDED_EVENT_TYPE,
        version: DIGEST_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: data.sourceKey,
      }),
    ];
  }

  static getAggregateId(payload: ProjectActivity): string {
    return projectWeekKey(payload);
  }
}

/** One coding-agent fact on a person's week; keyed by its source, so a redelivery appends once. */
export class RecordUserActivityCommand implements CommandHandler<
  Command<UserActivity>,
  UserActivityRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_USER_ACTIVITY_COMMAND_TYPE,
    userActivitySchema,
    "Fold one coding-agent fact into a person's digest week",
  );

  handle(command: Command<UserActivity>): UserActivityRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<UserActivityRecordedEvent>({
        aggregateType: DIGEST_WEEK_AGGREGATE_TYPE,
        aggregateId: userWeekKey(data),
        tenantId: createTenantId(command.tenantId),
        type: USER_ACTIVITY_RECORDED_EVENT_TYPE,
        version: DIGEST_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: data.sourceKey,
      }),
    ];
  }

  static getAggregateId(payload: UserActivity): string {
    return userWeekKey(payload);
  }
}
