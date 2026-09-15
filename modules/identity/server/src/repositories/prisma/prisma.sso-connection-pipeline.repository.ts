import {
  AdminEmailPlatformOperatorsRepository,
  type PrismaSsoPlatformOperatorDatabase,
} from "./prisma.sso-platform-operators.repository.ts";
import type { PlatformOperator } from "../../app/identity.members.ts";
import { LocalDoorBreakGlassBindingAdapter } from "../../services/local-door-break-glass-binding.service.ts";
import { SsoConnectionGuardsService } from "../../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../../services/sso-connection.service.ts";
import type { EventSourcing } from "@langwatch/eventing";
import { SsoConnectionPipelineDefinitionAdapter } from "../../services/sso-connection-pipeline-definition.service.ts";
import { SSO_CONNECTION_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { SsoConnectionEvent } from "../../projections/sso-connection-state.projection.ts";
import {
  SsoConnectionLedgerWriterAdapter,
  type SsoConnectionStagedSender,
} from "../../services/eventing-sso-connection-ledger.service.ts";
import {
  EventingSsoConnectionTeardownAdapter,
  SsoConnectionDirectoryRevocation,
  UnrevokedSsoConnectionDirectory,
} from "../../services/eventing-sso-connection-teardown.service.ts";
import {
  PrismaSsoConnectionProjectionRepository,
  type PrismaSsoConnectionProjectionDatabase,
} from "./prisma.sso-connection-projection.repository.ts";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
  type PrismaSsoConnectionReadDatabase,
  type PrismaSsoConnectionStrandingDatabase,
} from "./prisma.sso-connection-reads.repository.ts";

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
  operators: PlatformOperator;
  /** How a torn-down connection's directory tokens are retired, if at all. */
  directory?: SsoConnectionDirectoryRevocation;
};

/** The one graph the definition and the back office both command through. */
type SsoConnectionPipelineGraph = {
  head: ReturnType<typeof PrismaSsoConnectionProjectionRepository.create>;
  guards: SsoConnectionGuardsService;
  connections: SsoConnectionService;
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

  private composed: SsoConnectionPipelineGraph | undefined;

  /**
   * The connection write surface itself, for a process that commands connections without
   * running the pipeline — the operator back office is the one that does.
   *
   * The SAME instance {@link build} hands the teardown subscriber, so an operator's command
   * and the pipeline's own run the same guards over the same ledger writer. A second
   * composition here would give the back office its own break-glass budget.
   */
  connections(): SsoConnectionService {
    return this.compose().connections;
  }

  build(): ReturnType<typeof SsoConnectionPipelineDefinitionAdapter.create> {
    const { head, guards, connections } = this.compose();

    return SsoConnectionPipelineDefinitionAdapter.create({
      connectionProjectionStore: head,
      connectionGuards: guards,
      teardown: EventingSsoConnectionTeardownAdapter.create({
        connections: () => connections,
        directory: this.options.directory ?? UnrevokedSsoConnectionDirectory.create(),
      }),
    });
  }

  private compose(): SsoConnectionPipelineGraph {
    if (this.composed) return this.composed;
    const { database, eventSourcing, operators } = this.options;
    const head = PrismaSsoConnectionProjectionRepository.create(database);
    const guards = SsoConnectionGuardsService.create({
      connections: PrismaSsoConnectionReadRepository.create(database),
      breakGlass: LocalDoorBreakGlassBindingAdapter.create(),
      stranding: PrismaSsoConnectionStrandingRepository.create(database),
      platformOperators: AdminEmailPlatformOperatorsRepository.create({ database, operators }),
    });

    const connections = SsoConnectionService.create(
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

    this.composed = { head, guards, connections };
    return this.composed;
  }
}
