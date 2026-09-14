import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { EventingRecordSpanAdapter, type TraceSpanSpool } from "@langwatch/trace-server";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { createWorkerTraceContentDrop } from "./worker-trace-content-drop.composition.ts";
import { createWorkerTraceCostEnrichment } from "./worker-trace-cost-enrichment.composition.ts";
import { createWorkerTraceModelCostCatalogPort } from "./worker-trace-narrow-ports.composition.ts";
import { createWorkerTracePrivacy } from "./worker-trace-privacy.composition.ts";
import { createWorkerTraceTokenEstimation } from "./worker-trace-token-estimation.composition.ts";
import type { WorkerTraceCapabilityServices } from "./worker-trace-capability-services.composition.ts";

/**
 * Staged but not mounted; Trace hasn't converted. The four record-time ports
 * are now all composable.
 */
export function createWorkerRecordSpanCommand(options: {
  config: WorkerConfig;
  services: WorkerTraceCapabilityServices;
  featureFlags: FeatureFlagApi;
  spool?: TraceSpanSpool;
}): EventingRecordSpanAdapter {
  const { config, services } = options;

  return EventingRecordSpanAdapter.create({
    piiRedaction: createWorkerTracePrivacy({
      config: config.tracePrivacy,
      dataPrivacy: services.dataPrivacy,
      featureFlags: options.featureFlags,
    }).spanRedactionPort(),
    contentDrop: createWorkerTraceContentDrop({
      dataPrivacy: services.dataPrivacy,
      nativePolicyEnforced: config.tracePrivacy.nativePolicyEnforced,
    }).spanContentDropPort(),
    tokenEstimation: createWorkerTraceTokenEstimation({
      config: config.tokenizer,
      featureFlags: options.featureFlags,
    }).spanTokenEstimationPort(),
    costEnrichment: createWorkerTraceCostEnrichment({
      modelCosts: createWorkerTraceModelCostCatalogPort(services.modelCosts),
    }).spanCostEnrichmentPort(),
    ...(options.spool ? { spool: options.spool } : {}),
  });
}
