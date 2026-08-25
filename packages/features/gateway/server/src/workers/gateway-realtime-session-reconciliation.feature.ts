import {
  Capability,
  FeatureDefinition,
  type FeatureRuntimeContext,
} from "@langwatch/runtime-composition";
import {
  GatewayRealtimeSessionReconciliationWorker,
  type ElevenLabsConversationReader,
  type ElevenLabsCredentialReader,
  type RealtimeSessionReconciliationClock,
  type RealtimeSessionReconciliationConfig,
  type RealtimeSessionReconciliationLogger,
  type RealtimeSessionReconciliationRepository,
} from "./realtime-session-reconciliation.worker";

export interface GatewayRealtimeSessionReconciliationInfrastructure {
  repository: RealtimeSessionReconciliationRepository;
  credentials: ElevenLabsCredentialReader;
  conversations: ElevenLabsConversationReader;
  logger: RealtimeSessionReconciliationLogger;
  config: RealtimeSessionReconciliationConfig;
  clock: RealtimeSessionReconciliationClock;
}

export const gatewayRealtimeSessionReconciliationWorkerCapability =
  Capability.create<GatewayRealtimeSessionReconciliationWorker>(
    "gateway.realtime-session-reconciliation-worker",
  );

/**
 * Declares the worker lifecycle without allocating a timer until a worker
 * runtime builds this feature.
 */
export function createGatewayRealtimeSessionReconciliationFeature(): FeatureDefinition<GatewayRealtimeSessionReconciliationInfrastructure> {
  return FeatureDefinition.create({
    name: "gateway",
    provides: [gatewayRealtimeSessionReconciliationWorkerCapability],
    services: ({ infrastructure, provide }) => {
      provide(
        gatewayRealtimeSessionReconciliationWorkerCapability,
        GatewayRealtimeSessionReconciliationWorker.create(infrastructure),
      );
    },
    worker: (context) => installWorker(context),
  });
}

function installWorker(context: FeatureRuntimeContext): void {
  const worker = context.require(gatewayRealtimeSessionReconciliationWorkerCapability);
  const handle = worker.start();
  context.resources.own("gateway realtime-session reconciliation", () => handle.stop());
}
