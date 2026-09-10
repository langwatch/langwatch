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
 * `command:recordSpan`, whole, from a database and this process's own
 * configuration.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * the command and still records every span that lands — so this builds a
 * handler with no queue behind it. What has to be true today is that the
 * command CAN be built here, which is the half of the trace conversion that
 * halted: the four record-time ports each took a capability service by
 * parameter and not one of the six was constructible in this process.
 *
 * The four ports and what each one now rests on:
 *
 *     EventingRecordSpanAdapter                   (trace-server owns it)
 *       ├─ TraceSpanPiiRedaction      DataPrivacyResolution + flags + Presidio
 *       ├─ TraceSpanContentDrop       DataPrivacyResolution
 *       ├─ TraceSpanTokenEstimation   flags + the local BPE tables
 *       ├─ TraceSpanCostEnrichment    the project's own cost rules
 *       └─ TraceSpanSpool             optional; the stored-object runtime
 *
 * Every one of those five is now composable from the one Prisma client, the
 * queue's Redis, the deployment's own variables and the stored-object runtime
 * this process already holds. `ProjectApi`, `OrganizationService`,
 * `AuthzService` and `EvaluatorApi` are not among them and never were on
 * this path — they stood behind the WRITE halves of the four features, which
 * ingestion does not reach.
 *
 * THE SPOOL IS OPTIONAL AND ITS ABSENCE IS NOT A REFUSAL. A spool reference
 * appears on a command only when the ingestion door was handed a payload too
 * large to carry inline; a deployment with no object storage never produces
 * one, and the command's own `cleanupAfterStore` already returns early without
 * it. What it must not do is silently skip a spooled span, which is the
 * command's business and is asserted there rather than here.
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
