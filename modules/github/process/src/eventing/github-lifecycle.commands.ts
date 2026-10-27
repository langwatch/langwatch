import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  GITHUB_INSTALLATION_AGGREGATE_TYPE,
  GITHUB_INSTALLATION_CONNECTED_EVENT_TYPE,
  GITHUB_INSTALLATION_CONNECTED_EVENT_VERSION,
} from "@langwatch/github-contract";

import {
  type GithubInstallationConnectedEvent,
  RECORD_INSTALLATION_CONNECTED_COMMAND_TYPE,
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
