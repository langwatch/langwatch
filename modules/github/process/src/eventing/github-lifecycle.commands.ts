import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  GITHUB_INSTALLATION_AGGREGATE_TYPE,
  GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
  GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION,
  GITHUB_PULL_REQUEST_CHECKS_COMPLETED_EVENT_TYPE,
  GITHUB_PULL_REQUEST_CHECKS_COMPLETED_EVENT_VERSION,
} from "@langwatch/github-contract";

import {
  type GithubInstallationConnectedEvent,
  type GithubPullRequestChecksCompletedEvent,
  RECORD_INSTALLATION_CONNECTED_COMMAND_TYPE,
  RECORD_PULL_REQUEST_CHECKS_COMPLETED_COMMAND_TYPE,
  type RecordPullRequestChecksCompletedCommandData,
  recordPullRequestChecksCompletedCommandDataSchema,
  type RecordInstallationConnectedCommandData,
  recordInstallationConnectedCommandDataSchema,
} from "./github-lifecycle.events.ts";

/**
 * Records that an installation was connected to an organization. Each connect is its own
 * fact, keyed by its instant, so a redelivered command records nothing new.
 */
export class RecordInstallationConnectedCommand implements CommandHandler<
  Command<RecordInstallationConnectedCommandData>,
  GithubInstallationConnectedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_INSTALLATION_CONNECTED_COMMAND_TYPE,
    recordInstallationConnectedCommandDataSchema,
    "Record that a GitHub installation was connected to an organization",
  );

  handle(
    command: Command<RecordInstallationConnectedCommandData>,
  ): GithubInstallationConnectedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<GithubInstallationConnectedEvent>({
        aggregateType: GITHUB_INSTALLATION_AGGREGATE_TYPE,
        aggregateId: data.installationId,
        tenantId: createTenantId(command.tenantId),
        type: GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
        version: GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.installationId}:connected:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordInstallationConnectedCommandData): string {
    return payload.installationId;
  }

  static getSpanAttributes(
    payload: RecordInstallationConnectedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.github.installation.id": payload.installationId,
    };
  }
}

/**
 * Records that every check on an agent branch's head commit finished. One fact per commit:
 * the suites that finish together each ask, and the commit's key records only the first.
 */
export class RecordPullRequestChecksCompletedCommand implements CommandHandler<
  Command<RecordPullRequestChecksCompletedCommandData>,
  GithubPullRequestChecksCompletedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PULL_REQUEST_CHECKS_COMPLETED_COMMAND_TYPE,
    recordPullRequestChecksCompletedCommandDataSchema,
    "Record that every check on an agent pull request's head commit finished",
  );

  handle(
    command: Command<RecordPullRequestChecksCompletedCommandData>,
  ): GithubPullRequestChecksCompletedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<GithubPullRequestChecksCompletedEvent>({
        aggregateType: GITHUB_INSTALLATION_AGGREGATE_TYPE,
        aggregateId: data.installationId,
        tenantId: createTenantId(command.tenantId),
        type: GITHUB_PULL_REQUEST_CHECKS_COMPLETED_EVENT_TYPE,
        version: GITHUB_PULL_REQUEST_CHECKS_COMPLETED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.repositoryFullName.toLowerCase()}:${data.headSha}:checks_completed`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPullRequestChecksCompletedCommandData): string {
    return payload.installationId;
  }

  static getSpanAttributes(
    payload: RecordPullRequestChecksCompletedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.github.installation.id": payload.installationId,
      "payload.github.repository": payload.repositoryFullName,
      "payload.github.head_sha": payload.headSha,
    };
  }
}
