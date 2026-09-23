import type { EventSourcing } from "@langwatch/eventing";
import { JOIN_REQUEST_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { JoinRequestEvent } from "../../eventing/join-request-state.projection.ts";
import type { JoinRequestNotifier } from "../../rules/join-requests-contract.rules.ts";
import {
  EventingJoinRequestLedgerAdapter,
  type JoinRequestStagedSender,
} from "../../services/eventing-join-request-ledger.service.ts";
import { JoinRequestGuardsService } from "../../services/join-request-guards.service.ts";
import { JoinRequestLifecycleDispatcherAdapter } from "../../services/join-request-lifecycle-dispatcher.service.ts";
import {
  JoinRequestPipelineDefinitionAdapter,
  type JoinRequestPipeline,
} from "../../services/join-request-pipeline-definition.service.ts";
import { JoinRequestService } from "../../services/join-request.service.ts";
import { PrismaJoinRequestProjectionRepository } from "./prisma.join-request-projection.repository.ts";
import { PrismaJoinRequestReadRepository } from "./prisma.join-request.repository.ts";

/** Every model the join-request ledger reads or writes, and no other. */
export type JoinRequestPipelineDatabase = PrismaClient;

export type PostgresJoinRequestPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: JoinRequestPipelineDatabase;
  /**
   * The runtime this pipeline is registered on.
   */
  eventSourcing: EventSourcing;
  /** Who is told about each recorded fact, and how: the six join-request notices. */
  notifier: JoinRequestNotifier;
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
    const { database, eventSourcing, notifier } = this.options;
    const head = new PrismaJoinRequestProjectionRepository(database);
    const reads = new PrismaJoinRequestReadRepository(database);
    const guards = JoinRequestGuardsService.create({ requests: reads });

    const requests = JoinRequestService.create(
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
            const pipeline = eventSourcing.getPipeline(JOIN_REQUEST_PIPELINE_NAME);
            const command: JoinRequestStagedSender | undefined = pipeline.commands[name];
            return command ?? null;
          } catch {
            return null;
          }
        },
      }),
    );

    return JoinRequestPipelineDefinitionAdapter.create({
      joinRequestProjectionStore: head,
      joinRequestGuards: guards,
      lifecycle: JoinRequestLifecycleDispatcherAdapter.create(reads, notifier, () => requests),
    });
  }
}
