import { JoinRequestGuards } from "../join-request-guards";
import type { JoinRequestMailPort } from "../ports/join-request-mail.port";
import { JoinRequestService } from "../join-request.service";
import { PostgresJoinRequestNotificationAdapter } from "./postgres.join-request-notification.adapter";
import type { EventSourcing } from "@langwatch/eventing";
import {
  JoinRequestPipelineDefinitionAdapter,
  type JoinRequestPipeline,
} from "./join-request-pipeline-definition.adapter";
import { JOIN_REQUEST_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { JoinRequestEvent } from "../projections/join-request-state.projection";
import {
  EventingJoinRequestLedgerAdapter,
  type JoinRequestStagedSender,
} from "./eventing.join-request-ledger.adapter";
import { EventingJoinRequestLifecycleAdapter } from "./eventing.join-request-lifecycle.adapter";
import { PrismaJoinRequestProjectionRepository } from "../repositories/prisma/prisma.join-request-projection.repository";
import { PrismaJoinRequestReadRepository } from "../repositories/prisma/prisma.join-request.repository";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** Every model the join-request ledger reads or writes, and no other. */
export type JoinRequestPipelineDatabase = PrismaClient;

export type PostgresJoinRequestPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: JoinRequestPipelineDatabase;
  /**
   * The runtime this pipeline is registered on.
   */
  eventSourcing: EventSourcing;
  /** How the reminder and the lapse notice are rendered and sent. */
  mail: JoinRequestMailPort;
};

/**
 * What used to keep this graph in the application was the lifecycle port: its two wakes send mail,
 * and no process but the App had a mail gateway.
 * The Postgres composition seam for the join-request pipeline (D12, ADR-117).
 */
export class PostgresJoinRequestPipelineAdapter {
  static create(options: PostgresJoinRequestPipelineOptions): PostgresJoinRequestPipelineAdapter {
    return new PostgresJoinRequestPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresJoinRequestPipelineOptions) {}

  build(): JoinRequestPipeline {
    const { database, eventSourcing, mail } = this.options;
    const head = new PrismaJoinRequestProjectionRepository(database);
    const reads = new PrismaJoinRequestReadRepository(database);
    const guards = new JoinRequestGuards({ requests: reads });

    const requests = new JoinRequestService(
      guards,
      EventingJoinRequestLedgerAdapter.create({
        projectionStore: head,
        eventStore: async () => {
          const eventStore = eventSourcing.isEnabled
            ? eventSourcing.getEventStore<JoinRequestEvent>()
            : undefined;
          if (!eventStore) {
            // A plain Error on purpose (error doctrine): the caller cannot act
            // on an unavailable event stack, and the command degrades to a
            // retryable failure with a trace id.
            throw new Error(
              "join request ledger cannot append: the event-sourcing stack is unavailable",
            );
          }
          return eventStore;
        },
        tryResolveStagedSender: (name) => {
          if (!eventSourcing.isEnabled) return null;
          try {
            const pipeline = eventSourcing.getPipeline(JOIN_REQUEST_PIPELINE_NAME) as unknown as {
              commands: Record<string, JoinRequestStagedSender>;
            };
            return pipeline.commands[name] ?? null;
          } catch {
            return null;
          }
        },
      }),
    );

    return JoinRequestPipelineDefinitionAdapter.create({
      joinRequestProjectionStore: head,
      joinRequestGuards: guards,
      lifecycle: EventingJoinRequestLifecycleAdapter.create({
        requests,
        reads,
        notifications: PostgresJoinRequestNotificationAdapter.create({ database, mail }).build(),
      }),
    });
  }
}
