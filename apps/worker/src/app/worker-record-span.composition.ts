import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { RecordSpanCommand, type TraceSpanSpoolPort } from "@langwatch/trace-server";
import type { WorkerConfig } from "../platform/config/worker.config";
import { createWorkerTraceContentDrop } from "./worker-trace-content-drop.composition";
import { createWorkerTraceCostEnrichment } from "./worker-trace-cost-enrichment.composition";
import { createWorkerTraceModelCostCatalogPort } from "./worker-trace-narrow-ports.composition";
import { createWorkerTracePrivacy } from "./worker-trace-privacy.composition";
import { createWorkerTraceTokenEstimation } from "./worker-trace-token-estimation.composition";
import type { WorkerTraceCapabilityServices } from "./worker-trace-capability-services.composition";

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
 *     RecordSpanCommand                   (trace-server owns it)
 *       ├─ TraceSpanPiiRedactionPort      DataPrivacyResolutionPort + flags + Presidio
 *       ├─ TraceSpanContentDropPort       DataPrivacyResolutionPort
 *       ├─ TraceSpanTokenEstimationPort   flags + the local BPE tables
 *       ├─ TraceSpanCostEnrichmentPort    the project's own cost rules
 *       └─ TraceSpanSpoolPort             optional; the stored-object runtime
 *
 * Every one of those five is now composable from the one Prisma client, the
 * queue's Redis, the deployment's own variables and the stored-object runtime
 * this process already holds. `ProjectService`, `OrganizationService`,
 * `AuthzService` and `EvaluatorService` are not among them and never were on
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
  featureFlags: FeatureFlagService;
  spool?: TraceSpanSpoolPort;
}): RecordSpanCommand {
  const { config, services } = options;

  return RecordSpanCommand.create({
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
