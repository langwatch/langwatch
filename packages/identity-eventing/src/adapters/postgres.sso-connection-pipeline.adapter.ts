import {
  AdminEmailPlatformOperators,
  LocalDoorBreakGlassBinding,
  SsoConnectionGuards,
  SsoConnectionService,
  type PrismaSsoPlatformOperatorDatabase,
} from "@langwatch/identity-server";
import type { EventSourcing } from "@langwatch/eventing";
import { createSsoConnectionPipeline } from "../sso-connections/pipeline";
import { SSO_CONNECTION_PIPELINE_NAME } from "../sso-connections/schemas/constants";
import type { SsoConnectionEvent } from "../sso-connections/schemas/events";
import {
  SsoConnectionLedgerWriter,
  type SsoConnectionStagedSender,
} from "./eventing.sso-connection-ledger.adapter";
import {
  EventingSsoConnectionTeardownAdapter,
  SsoConnectionDirectoryRevocationPort,
  UnrevokedSsoConnectionDirectory,
} from "./eventing.sso-connection-teardown.adapter";
import {
  PrismaSsoConnectionProjectionRepository,
  type PrismaSsoConnectionProjectionDatabase,
} from "../repositories/prisma/prisma.sso-connection-projection.repository";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
  type PrismaSsoConnectionReadDatabase,
  type PrismaSsoConnectionStrandingDatabase,
} from "../repositories/prisma/prisma.sso-connection-reads.repository";

/** Every model the connection ledger reads or writes, and no other. */
export type SsoConnectionPipelineDatabase = PrismaSsoConnectionProjectionDatabase &
  PrismaSsoConnectionReadDatabase &
  PrismaSsoConnectionStrandingDatabase &
  PrismaSsoPlatformOperatorDatabase;

export type PostgresSsoConnectionPipelineOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: SsoConnectionPipelineDatabase;
  /**
   * The runtime this pipeline is registered on.
   *
   * Taken rather than a resolved event store and sender, because the teardown
   * grace wake dispatches `completeTeardown` back into this same pipeline: a
   * writer that resolved its sender eagerly could only be built after the
   * pipeline it needs, and this graph would then have no order that composes.
   */
  eventSourcing: EventSourcing;
  /**
   * `ADMIN_EMAILS`, the deployment's operator list.
   *
   * The same variable that already decides who reaches the back office, and
   * deliberately not `ops:*` — if that permission ever widens, "who may attest
   * a customer's domain" must not widen with it silently. Unset means nobody.
   */
  adminEmails: string | undefined;
  /** How a torn-down connection's directory tokens are retired, if at all. */
  directory?: SsoConnectionDirectoryRevocationPort;
};

/**
 * The Postgres composition seam for the SSO connection pipeline (D04,
 * ADR-117 §5).
 *
 * This is the ONLY graph that can advance TEARDOWN_PENDING to TORN_DOWN: the
 * transition happens through the process manager's wake and nowhere else, so
 * a connection whose teardown was requested sits at pending for as long as no
 * process registers this pipeline.
 *
 * What used to keep the graph in the application was the teardown port, whose
 * wake dispatched through a service bound to the App singleton and then
 * revoked directory tokens through the SCIM capability. Both are seams now:
 * the ledger resolves its event store and sender off the runtime it is
 * registered on, and the revocation is a one-method port a process without a
 * directory answers by name.
 *
 * The head is composed ONCE and shared: the guards read the state the fold
 * writes, and two instances reading one table would still agree today, but the
 * seam is what makes a divergent second reader unexpressible.
 */
export class PostgresSsoConnectionPipelineAdapter {
  static create(options: PostgresSsoConnectionPipelineOptions): PostgresSsoConnectionPipelineAdapter {
    return new PostgresSsoConnectionPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresSsoConnectionPipelineOptions) {}

  build(): ReturnType<typeof createSsoConnectionPipeline> {
    const { database, eventSourcing, adminEmails } = this.options;
    const head = PrismaSsoConnectionProjectionRepository.create(database);
    const guards = new SsoConnectionGuards({
      connections: PrismaSsoConnectionReadRepository.create(database),
      breakGlass: new LocalDoorBreakGlassBinding(),
      stranding: PrismaSsoConnectionStrandingRepository.create(database),
      platformOperators: AdminEmailPlatformOperators.create({ database, adminEmails }),
    });

    const connections = new SsoConnectionService(
      guards,
      SsoConnectionLedgerWriter.create({
        projectionStore: head,
        eventStore: async () => {
          const eventStore = eventSourcing.isEnabled
            ? eventSourcing.getEventStore<SsoConnectionEvent>()
            : undefined;
          if (!eventStore) {
            // A plain Error on purpose (error doctrine): the caller cannot act
            // on an unavailable event stack, and the command degrades to a
            // retryable failure with a trace id.
            throw new Error(
              "sso connection ledger cannot append: the event-sourcing stack is unavailable",
            );
          }
          return eventStore;
        },
        stagedSender: (name) => {
          if (!eventSourcing.isEnabled) return null;
          try {
            const pipeline = eventSourcing.getPipeline(
              SSO_CONNECTION_PIPELINE_NAME as never,
            ) as unknown as { commands: Record<string, SsoConnectionStagedSender> };
            return pipeline.commands[name] ?? null;
          } catch {
            return null;
          }
        },
      }),
    );

    return createSsoConnectionPipeline({
      connectionProjectionStore: head,
      connectionGuards: guards,
      teardown: EventingSsoConnectionTeardownAdapter.create({
        connections: () => connections,
        directory: this.options.directory ?? UnrevokedSsoConnectionDirectory.create(),
      }),
    });
  }
}
