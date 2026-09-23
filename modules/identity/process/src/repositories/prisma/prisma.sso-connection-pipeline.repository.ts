import type { EventSourcing } from "@langwatch/eventing";
import { SSO_CONNECTION_PIPELINE_NAME } from "@langwatch/identity-contract";

import type { PlatformOperator, SsoDomainProofMail } from "../../app/identity.members.ts";
import type { SsoConnectionEvent } from "../../eventing/sso-connection-state.projection.ts";
import type { SsoDomainProofNotifications } from "../../eventing/sso-domain-proof-notification.process.ts";
import {
  SsoConnectionLedgerWriterAdapter,
  type SsoConnectionStagedSender,
} from "../../services/eventing-sso-connection-ledger.service.ts";
import type { SsoConnectionDirectoryRevocation } from "../../services/eventing-sso-connection-teardown.service.ts";
import {
  EventingSsoConnectionTeardownAdapter,
  UnrevokedSsoConnectionDirectory,
} from "../../services/eventing-sso-connection-teardown.service.ts";
import { LocalDoorBreakGlassBindingAdapter } from "../../services/local-door-break-glass-binding.service.ts";
import { SsoBreakGlassRecoveryService } from "../../services/sso-break-glass-recovery.service.ts";
import { RequiresLocalDoorAndBinding } from "../../services/sso-break-glass.service.ts";
import { SsoConnectionGuardsService } from "../../services/sso-connection-guards.service.ts";
import { SsoConnectionPipelineDefinitionAdapter } from "../../services/sso-connection-pipeline-definition.service.ts";
import { SsoConnectionService } from "../../services/sso-connection.service.ts";
import {
  SsoDomainProofNotificationService,
  UnaddressedSsoDomainProofNotifications,
} from "../../services/sso-domain-proof-notification.service.ts";
import type { SsoEngineProviderProjection } from "../sso-engine-provider.repository.ts";
import {
  PrismaJoinRequestAudienceRepository,
  type PrismaJoinRequestAudienceDatabase,
} from "./prisma.join-request-audience.repository.ts";
import {
  type PrismaSsoBreakGlassDatabase,
  PrismaSsoBreakGlassRepository,
} from "./prisma.sso-break-glass.repository.ts";
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
import {
  type PrismaSsoConnectionRegistrationDatabase,
  PrismaSsoConnectionRegistrationRepository,
} from "./prisma.sso-connection-registration.repository.ts";
import {
  AdminEmailPlatformOperatorsRepository,
  type PrismaSsoPlatformOperatorDatabase,
} from "./prisma.sso-platform-operators.repository.ts";

/**
 * Every model the connection ledger reads or writes, and no other — plus the
 * members a domain-proof notice is addressed to, which is the audience the
 * join-request notices already read.
 */
export type SsoConnectionPipelineDatabase = PrismaSsoBreakGlassDatabase &
  PrismaSsoConnectionRegistrationDatabase &
  PrismaSsoConnectionProjectionDatabase &
  PrismaSsoConnectionReadDatabase &
  PrismaSsoConnectionStrandingDatabase &
  PrismaSsoPlatformOperatorDatabase &
  PrismaJoinRequestAudienceDatabase;

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
  /**
   * How a missing domain proof reaches the organization's administrators.
   * Absent where the process composed no gateway — the state still moves,
   * and the unsent notice is logged rather than retried forever.
   */
  mail?: SsoDomainProofMail;
  /**
   * How the engine's provider rows follow the head this pipeline folds (D09).
   * Absent, the engine's table is not maintained — a process that mounts no
   * sign-in door needs none.
   */
  engineProvider?: SsoEngineProviderProjection;
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
   * The connection write surface for a process commanding connections
   * without running the pipeline. The SAME instance {@link build} hands the
   * teardown subscriber, avoiding a second break-glass budget.
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
      proofNotifications: this.proofNotifications(),
    });
  }

  private proofNotifications(): SsoDomainProofNotifications {
    const mail = this.options.mail;
    if (!mail) return UnaddressedSsoDomainProofNotifications.create();
    return SsoDomainProofNotificationService.create({
      audience: PrismaJoinRequestAudienceRepository.create(this.options.database),
      mail,
    });
  }

  private compose(): SsoConnectionPipelineGraph {
    if (this.composed) return this.composed;
    const { database, eventSourcing, operators } = this.options;
    const head = PrismaSsoConnectionProjectionRepository.create(
      database,
      this.options.engineProvider,
    );
    const guards = SsoConnectionGuardsService.create({
      connections: PrismaSsoConnectionReadRepository.create(database),
      registrationSlots: PrismaSsoConnectionRegistrationRepository.create(database),
      breakGlass: RequiresLocalDoorAndBinding.create({
        localDoor: LocalDoorBreakGlassBindingAdapter.create(),
        bindings: SsoBreakGlassRecoveryService.create({
          bindings: PrismaSsoBreakGlassRepository.create(database),
        }),
      }),
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
            const pipeline = eventSourcing.getPipeline(SSO_CONNECTION_PIPELINE_NAME);
            const command: SsoConnectionStagedSender | undefined = pipeline.commands[name];
            return command ?? null;
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
