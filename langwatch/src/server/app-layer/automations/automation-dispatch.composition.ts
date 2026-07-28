import type { PrismaClient } from "@prisma/client";

import { env } from "~/env.mjs";
// LAYERING DEBT — the one import in this file that points upward.
// `getProtectionsForProject` resolves a project's data-privacy redaction
// policy; it has nothing to do with tRPC and only lives under `api/` for
// historical reasons. Moving it (together with `getUserProtectionsForProject`,
// `getVisibilityCutoffMsForProject` and the ~350 lines of policy resolution
// they share) touches roughly thirty call sites plus eight `vi.mock`
// module-path strings, so it is its own change rather than a rider on
// ADR-077 step 2. It is held HERE, in the automations composition root, so
// that no file under `event-sourcing/` reaches into the router layer.
import { getProtectionsForProject } from "~/server/api/utils";
import type { AnnotationService } from "~/server/annotations/annotation.service";
import { DatasetService } from "~/server/datasets/dataset.service";
import type { AutomationDispatchCollaborators } from "~/server/event-sourcing/pipelines/automations/automationDispatch.adapter";
import { TraceSummaryStore } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.store";
import { CachedFoldStore } from "~/server/event-sourcing/projections/cachedFoldStore";
import type { FoldCacheClient } from "~/server/event-sourcing/projections/foldCache/foldCacheClient";
import { TraceService } from "~/server/traces/trace.service";
import type { EvaluationRunService } from "../evaluations/evaluation-run.service";
import type { ProjectService } from "../projects/project.service";
import type { TraceSummaryRepository } from "../traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../traces/span-storage.service";
import { SystemTraceReadService } from "../traces/system-trace-read.service";
import { TraceReadDerivationService } from "../traces/trace-read-derivation.service";
import { AutomationCustomGraphService } from "./custom-graph.service";
import type { EmailSuppressionService } from "./emailSuppression.service";
import {
  defaultCandidateSources,
  defaultGraphTriggerHeartbeatDeps,
} from "./graph-trigger-heartbeat";
import { PrismaGraphTriggerSentRepository } from "./repositories/trigger.prisma.repository";
import type { TriggerService } from "./trigger.service";
import { WebhookDeliveryService } from "./webhook-delivery.service";

/**
 * ADR-077: the composition root for automation dispatch. Everything the
 * automations pipeline's layer-5 adapter needs is constructed here — services,
 * repositories, projection stores, and the config values read out of the
 * environment. The adapter that consumes this
 * (`event-sourcing/pipelines/automations/automationDispatch.adapter.ts`) then
 * contains nothing but `port: (args) => collaborator.method(args)`.
 *
 * Constructed on every process role. Registration is passive shape; only roles
 * that run workers ever drive the outbox and wake loops.
 */
export function createAutomationDispatchCollaborators({
  prisma,
  foldCacheClient,
  triggers,
  annotations,
  emailSuppressions,
  projects,
  evaluationRuns,
  spanStorage,
  traceSummaryRepository,
}: {
  prisma: PrismaClient;
  foldCacheClient: FoldCacheClient;
  triggers: TriggerService;
  /** The app's own annotation service — the SAME instance the tRPC layer gets
   *  off `getApp()`, so the two "add to queue" entry points cannot diverge. */
  annotations: AnnotationService;
  emailSuppressions: EmailSuppressionService;
  projects: ProjectService;
  evaluationRuns: EvaluationRunService;
  spanStorage: SpanStorageService;
  traceSummaryRepository: TraceSummaryRepository;
}): AutomationDispatchCollaborators {
  // Fail loud if BASE_HOST is missing: every alert dispatch interpolates it
  // into deep links; an empty baseHost silently ships broken links.
  const baseHost = env.BASE_HOST;
  if (!baseHost) {
    throw new Error(
      "BASE_HOST is unset — automation dispatch cannot render deep links (email + Slack alert templates interpolate baseHost). Set env.BASE_HOST before booting the worker.",
    );
  }

  return {
    baseHost,
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,

    triggers,
    projects,
    evaluationRuns,
    emailSuppressions,
    annotations,

    // Composed exactly as the trace pipeline composes its own trace_summaries
    // fold — same cache tier, same key prefix — so the settle confirm reads
    // what that writer wrote (ADR-077 §3).
    traceSummaryStore: new CachedFoldStore(
      new TraceSummaryStore(traceSummaryRepository),
      foldCacheClient,
      { keyPrefix: "trace_summaries" },
    ),
    traceReadDerivation: new TraceReadDerivationService(spanStorage),
    traceReads: new SystemTraceReadService({
      traces: TraceService.create(prisma),
      resolveProtections: (projectId) =>
        getProtectionsForProject(prisma, { projectId }),
    }),

    // The TriggerSent repo mirrors the legacy dedup pattern exactly.
    graphTriggerSent: new PrismaGraphTriggerSentRepository(prisma),
    // ADR-040 §6: one delivery-log writer shared by the digest dispatch and
    // the graph-alert path.
    webhookDeliveries: WebhookDeliveryService.create(prisma),
    // Graph-config loads go through the automations-owned service, not raw
    // prisma.
    customGraphs: AutomationCustomGraphService.create(prisma),
    datasets: DatasetService.create(prisma),

    heartbeat: {
      deps: defaultGraphTriggerHeartbeatDeps({ triggers, prisma }),
      sources: defaultCandidateSources(prisma),
    },
  };
}
