import {
  AdminEmailPlatformOperatorsRepository,
  type PrismaSsoPlatformOperatorDatabase,
} from "../repositories/prisma/prisma.sso-platform-operators.repository";
import type { PlatformOperatorPort } from "../ports/platform-operator.port";
import { LocalDoorBreakGlassBindingAdapter } from "./local-door-break-glass-binding.adapter";
import { SsoConnectionGuards } from "../sso-connection-guards";
import { SsoConnectionService } from "../sso-connection.service";
import type { EventSourcing } from "@langwatch/eventing";
import { SsoConnectionPipelineDefinitionAdapter } from "./sso-connection-pipeline-definition.adapter";
import { SSO_CONNECTION_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { SsoConnectionEvent } from "../projections/sso-connection-state.projection";
import {
  SsoConnectionLedgerWriterAdapter,
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
   */
  eventSourcing: EventSourcing;
  /**
   * The deployment's operator list, as a port. `ADMIN_EMAILS` is the same variable that already
   * decides who reaches the back office, and deliberately not `ops:*` — if that permission ever
   * widens, "who may attest a customer's domain" must not widen with it silently.
   */
  operators: PlatformOperatorPort;
  /** How a torn-down connection's directory tokens are retired, if at all. */
  directory?: SsoConnectionDirectoryRevocationPort;
};

/**
 * The Postgres composition seam for the SSO connection pipeline (D04, This is the ONLY graph that
 * can advance TEARDOWN_PENDING to TORN_DOWN:
 * ADR-117 §5).
 */
export class PostgresSsoConnectionPipelineAdapter {
  static create(
    options: PostgresSsoConnectionPipelineOptions,
  ): PostgresSsoConnectionPipelineAdapter {
    return new PostgresSsoConnectionPipelineAdapter(options);
  }

  private constructor(private readonly options: PostgresSsoConnectionPipelineOptions) {}

  build(): ReturnType<typeof SsoConnectionPipelineDefinitionAdapter.create> {
    const { database, eventSourcing, operators } = this.options;
    const head = PrismaSsoConnectionProjectionRepository.create(database);
    const guards = new SsoConnectionGuards({
      connections: PrismaSsoConnectionReadRepository.create(database),
      breakGlass: LocalDoorBreakGlassBindingAdapter.create(),
      stranding: PrismaSsoConnectionStrandingRepository.create(database),
      platformOperators: AdminEmailPlatformOperatorsRepository.create({ database, operators }),
    });

    const connections = new SsoConnectionService(
      guards,
      SsoConnectionLedgerWriterAdapter.create({
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

    return SsoConnectionPipelineDefinitionAdapter.create({
      connectionProjectionStore: head,
      connectionGuards: guards,
      teardown: EventingSsoConnectionTeardownAdapter.create({
        connections: () => connections,
        directory: this.options.directory ?? UnrevokedSsoConnectionDirectory.create(),
      }),
    });
  }
}
