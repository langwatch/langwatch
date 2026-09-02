import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import { AppGovernanceEventingAdapter } from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import { TraceProcessingServerInstaller } from "@langwatch/trace-server";
import type {
  WorkerGlobalProjectionsCompositionOptions,
  WorkerProductionCompositionOptions,
} from "@langwatch/worker";
import type {
  WorkerEventingHandoff,
  WorkerEventingSubstrate,
} from "~/server/app-layer/worker-eventing-handoff";
import { createBillingMeterDispatchSubscriber } from "~/server/event-sourcing/registration/global/billingMeterDispatch.subscriber";
import { orgBillableEventsMeterProjection } from "~/server/event-sourcing/registration/global/orgBillableEventsMeter.mapProjection";

/**
 * The handoff, once it is known to describe a graph that can consume.
 *
 * `groupQueue` is the one substrate member the packaged Eventing runtime
 * cannot do without, and it is absent exactly when the App had no Redis — so
 * narrowing it here is what lets every mapper below read the substrate without
 * restating the refusal.
 */
export type PackagedWorkerConsumerHandoff = Omit<WorkerEventingHandoff, "substrate"> & {
  substrate: Omit<WorkerEventingSubstrate, "groupQueue"> & {
    groupQueue: NonNullable<WorkerEventingSubstrate["groupQueue"]>;
  };
};

/** A packaged worker composition that cannot become the queue's one consumer. */
export class PackagedWorkerConsumerRefusal extends Error {
  readonly name = "PackagedWorkerConsumerRefusal";

  constructor(reason: string) {
    super(`The packaged worker composition will not claim event-sourcing/jobs: ${reason}.`);
  }
}

/**
 * Whether this App handed over a graph the packaged composition may consume
 * with, stated before anything is built.
 *
 * Every branch below is a way to end up producer-only without noticing. A
 * worker whose queue is claimed by nobody looks healthy from every angle the
 * fleet watches — the pods are up, the liveness probe answers, the queue depth
 * simply grows — so each one is a refusal to start rather than a warning.
 *
 * `clickHouseEnabled` is passed in rather than read here: it is the same
 * process-wide fact `initializeDefaultApp` consulted when it decided whether to
 * build an event store at all, and the caller is the one holding the App.
 */
export function requirePackagedWorkerConsumer(options: {
  handoff: WorkerEventingHandoff | undefined;
  clickHouseEnabled: boolean;
}): PackagedWorkerConsumerHandoff {
  const { handoff, clickHouseEnabled } = options;
  if (!handoff) {
    throw new PackagedWorkerConsumerRefusal(
      "the App reported no worker eventing handoff, so this process has no registered graph to mount",
    );
  }
  if (handoff.appOwnsEventingConsumers) {
    throw new PackagedWorkerConsumerRefusal(
      "the App claimed the consumers itself, and one process must never hold two",
    );
  }
  if (!clickHouseEnabled) {
    throw new PackagedWorkerConsumerRefusal(
      "ClickHouse is unavailable, and the Eventing event store has no other backing",
    );
  }
  if (!handoff.substrate.groupQueue) {
    throw new PackagedWorkerConsumerRefusal(
      "Redis is unavailable, so the App built no group queue for this graph to join",
    );
  }
  return handoff as PackagedWorkerConsumerHandoff;
}

/** The Eventing option arm taken by a composition that brings its own substrate. */
type PackagedWorkerEventingOptions = Extract<
  WorkerProductionCompositionOptions,
  { infrastructure?: undefined }
>["eventing"];

/**
 * The App's own Eventing substrate, with the consumer turned on.
 *
 * The objects are handed through rather than rebuilt. Two runtimes over two
 * Redis connections would offload payloads through two staging paths and stage
 * retention against two configurations; over these they are one substrate with
 * two graphs on it, and the bytes the packaged consumer stages are the bytes
 * the App's producers stage.
 *
 * This is the only place in the process allowed to ask for consumers, and it
 * can only be reached through a handoff that has already reported the App is
 * not claiming them.
 */
export function packagedWorkerEventing(
  handoff: PackagedWorkerConsumerHandoff,
): PackagedWorkerEventingOptions {
  const { substrate } = handoff;
  return {
    database: substrate.prisma,
    resolveClickHouseClient: substrate.resolveClickHouseClient,
    groupQueue: substrate.groupQueue,
    retention: substrate.persistenceRetention,
    ...(substrate.retentionPolicyResolver
      ? { retentionPolicyResolver: substrate.retentionPolicyResolver }
      : {}),
    consumers: {
      enabled: true,
      ...(substrate.replayMarkerChecker
        ? { replayMarkerChecker: substrate.replayMarkerChecker }
        : {}),
    },
  };
}

/**
 * The late binding every synthesized capability declines to perform.
 *
 * A worker feature's `connect*` hook exists to hand a producer the dispatcher
 * its own registration produced, and each one resolves a `Deferred` that
 * refuses a second resolution. Every definition mapped below arrived already
 * registered on the App's runtime, where `registerAll()` resolved exactly those
 * deferreds against the App's dispatchers — so calling through would throw, and
 * the packaged installers deliberately call a hook that does nothing.
 *
 * Exported so a test can assert identity rather than infer intent: every
 * `connect*` this module produces IS this function.
 */
export const workerCapabilityAlreadyConnected = (): void => void 0;

/**
 * The SaaS meter's usage sender, resolved when a billable event is dispatched
 * rather than when these options are built.
 *
 * The pipeline that answers it is registered by the very composition the
 * options are passed to, so nothing here can hold a direct handle.
 */
export type PackagedWorkerBillingUsageDispatch = () => (
  data: ReportUsageForMonthCommandData,
) => Promise<void>;

/** Everything a packaged worker mounts, minus the process boundaries it is given. */
export type PackagedWorkerCapabilityOptions = Omit<
  WorkerProductionCompositionOptions,
  | "config"
  | "eventing"
  | "infrastructure"
  | "lifecycle"
  | "observability"
  | "resources"
  | "transport"
>;

/**
 * The App's registered graph, as the options `WorkerProductionComposition`
 * takes.
 *
 * A pipeline DEFINITION is a static description: the routing keys it registers
 * come from the command, projection, subscriber and process names its feature
 * declared, never from the ports its handlers will later call. Handing one to a
 * second runtime therefore registers the identical keys, and the ~77
 * collaborators behind them never move. That is what makes this a mapping
 * rather than a re-composition, and what lets each Wave 2/3 extraction replace
 * one entry here with a feature package's own capability without the graph on
 * either side of the seam changing shape.
 */
export function packagedWorkerCapabilities(options: {
  handoff: WorkerEventingHandoff;
  billingUsageDispatch: PackagedWorkerBillingUsageDispatch;
}): PackagedWorkerCapabilityOptions {
  const { capabilities, isSaas, topic } = options.handoff;
  const definition = (name: string) => capabilities.definition(name);

  return {
    automation: { installer: { buildPipeline: () => definition("automations") } },
    eventingMaintenance: capabilities.eventingMaintenance,
    evaluation: { installer: { buildProcessing: () => definition("evaluation_processing") } },
    codingAgent: { installer: { buildProcessing: () => definition("coding_agent_processing") } },
    gatewaySpend: {
      governance: { buildProcessing: () => definition("governance_events_processing") },
      spend: {
        buildProcessing: () => definition("gateway_spend_processing"),
        connectSettlement: workerCapabilityAlreadyConnected,
      },
    },
    trace: { installer: TraceProcessingServerInstaller.create(capabilities.trace) },
    scenario: {
      installer: {
        buildProcessing: () => definition("simulation_processing"),
        connect: workerCapabilityAlreadyConnected,
      },
    },
    experiment: { installer: { buildProcessing: () => definition("experiment_run_processing") } },
    langyConversation: {
      installer: {
        buildProcessing: () => definition("langy_conversation_processing"),
        connectCommands: workerCapabilityAlreadyConnected,
      },
    },
    topic,
    governanceIngestion: {
      installer: {
        register: (eventSourcing) =>
          AppGovernanceEventingAdapter.create(
            eventSourcing,
            capabilities.governanceRuntime,
          ).register(),
      },
    },
    billingReporting: {
      installer: {
        buildProcessing: () => definition("billing_reporting"),
        connectSelfDispatch: workerCapabilityAlreadyConnected,
      },
    },
    authz: {
      installer: {
        pipeline: definition("authz_grant"),
        connect: workerCapabilityAlreadyConnected,
      },
    },
    identity: {
      identity: { pipeline: definition("identity") },
      ssoConnection: { pipeline: definition("sso-connections") },
      scimSync: { pipeline: definition("scim-sync") },
      joinRequest: { pipeline: definition("join-requests") },
    },
    ...(isSaas
      ? { globalProjections: { configure: saasGlobalProjections(options.billingUsageDispatch) } }
      : {}),
  };
}

/**
 * The cross-pipeline pair a SaaS install configures on the runtime itself.
 *
 * Their `global:*` keys share `event-sourcing/jobs` with every pipeline's, so a
 * consumer without them rejects every billable span, evaluation, experiment and
 * simulation event for redelivery. A fresh closure rather than the App's is
 * deliberate — the App's closes over the App's own EventSourcing — but both are
 * gated on the one `config.isSaas` the handoff carries, so the two graphs can
 * never disagree about whether these keys exist.
 */
function saasGlobalProjections(
  billingUsageDispatch: PackagedWorkerBillingUsageDispatch,
): WorkerGlobalProjectionsCompositionOptions["configure"] {
  return (registry) => {
    registry.registerMapProjection(orgBillableEventsMeterProjection);
    registry.registerMapSubscriber(
      "orgBillableEventsMeter",
      createBillingMeterDispatchSubscriber({ getDispatch: billingUsageDispatch }),
    );
  };
}
