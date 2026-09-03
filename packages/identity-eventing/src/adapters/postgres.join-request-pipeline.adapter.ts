import {
  JoinRequestGuards,
  type JoinRequestMailPort,
  JoinRequestService,
  PostgresJoinRequestNotificationAdapter,
  type JoinRequestNotificationDatabase,
} from "@langwatch/identity-server";
import type { EventSourcing, EventStore } from "@langwatch/eventing";
import { createJoinRequestPipeline, type JoinRequestPipeline } from "../join-requests/pipeline";
import { JOIN_REQUEST_PIPELINE_NAME } from "../join-requests/schemas/constants";
import type { JoinRequestEvent } from "../join-requests/schemas/events";
import {
  EventingJoinRequestLedgerAdapter,
  type JoinRequestStagedSender,
} from "./eventing.join-request-ledger.adapter";
import { EventingJoinRequestLifecycleAdapter } from "./eventing.join-request-lifecycle.adapter";
import {
  PrismaJoinRequestProjectionRepository,
  type PrismaJoinRequestProjectionDatabase,
} from "../repositories/prisma/prisma.join-request-projection.repository";

/** Every model the join-request ledger reads or writes, and no other. */
export type JoinRequestPipelineDatabase = PrismaJoinRequestProjectionDatabase &
  JoinRequestNotificationDatabase;

export type PostgresJoinRequestPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: JoinRequestPipelineDatabase;
  /**
   * The runtime this pipeline is registered on.
   *
   * Taken rather than a resolved event store and sender, because the expiry
   * wake dispatches `expireJoin` back into this same pipeline: a writer that
   * resolved its sender eagerly could only be built after the pipeline it
   * needs, and this graph would then have no order that composes.
   */
  eventSourcing: EventSourcing;
  /** How the reminder and the lapse notice are rendered and sent. */
  mail: JoinRequestMailPort;
};

/**
 * The Postgres composition seam for the join-request pipeline (D12, ADR-117).
 *
 * What used to keep this graph in the application was the lifecycle port: its
 * two wakes send mail, and no process but the App had a mail gateway. With
 * outbound delivery packaged, everything left is a Postgres binding or the
 * runtime this pipeline already runs on — the `JoinRequest` head serving both
 * the fold and its guards, the audience the two notices are addressed to, and
 * the command lane the expiry dispatches through.
 *
 * The head is composed ONCE and shared: the guards read the state the fold
 * writes, and two instances reading one table would still agree today, but the
 * seam is what makes a divergent second reader unexpressible.
 */
export class PostgresJoinRequestPipelineAdapter {
  static create(options: PostgresJoinRequestPipelineOptions): PostgresJoinRequestPipelineAdapter {
    return new PostgresJoinRequestPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresJoinRequestPipelineOptions) {}

  build(): JoinRequestPipeline {
    const { database, eventSourcing, mail } = this.options;
    const head = PrismaJoinRequestProjectionRepository.create(database);
    const guards = new JoinRequestGuards({ requests: head });

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

    return createJoinRequestPipeline({
      joinRequestProjectionStore: head,
      joinRequestGuards: guards,
      lifecycle: EventingJoinRequestLifecycleAdapter.create({
        requests,
        reads: head,
        notifications: PostgresJoinRequestNotificationAdapter.create({ database, mail }).build(),
      }),
    });
  }
}
