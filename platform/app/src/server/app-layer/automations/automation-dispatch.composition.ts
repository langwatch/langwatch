import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";

import { env } from "~/env.mjs";
import type { AnnotationService } from "~/server/annotations/annotation.service";
// LAYERING DEBT — the one import in this file that points upward.
// `getProtectionsForProject` resolves a project's data-privacy redaction
// policy; it has nothing to do with tRPC and only lives under `api/` for
// historical reasons. Moving it (together with `getUserProtectionsForProject`,
// `getVisibilityCutoffMsForProject` and the ~350 lines of policy resolution
// they share) touches roughly thirty call sites plus eight `vi.mock`
// module-path strings, so it is its own change rather than a rider on
// ADR-082 step 2. It is held HERE, in the automations composition root, so
// that no file under `event-sourcing/` reaches into the router layer.
import { getProtectionsForProject } from "~/server/api/utils";
import { getAnalyticsService } from "~/server/app-layer/analytics";
import { DatasetService } from "~/server/datasets/dataset.service";
import type { AutomationDispatchCollaborators } from "~/server/event-sourcing.old/pipelines/automations/automationDispatch.adapter";
import { TraceSummaryStore } from "~/server/event-sourcing.old/pipelines/trace-processing/projections/traceSummary.store";
import { CachedFoldStore } from "~/server/event-sourcing.old/projections/cachedFoldStore";
import type { FoldCacheClient } from "~/server/event-sourcing.old/projections/foldCache/foldCacheClient";
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

const logger = createLogger("langwatch:automation-dispatch-composition");

/**
 * ADR-082: the composition root for automation dispatch. Everything the
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
  // BASE_HOST is required by the env schema (`src/env-create.mjs`), which is
  // where a missing value fails — and it fails there for every role at once.
  // These collaborators are built on EVERY process role, including ones that
  // never dispatch an alert, so re-asserting it here would turn the schema's
  // build-time/validation-skipped escape hatch into a boot failure for roles
  // that never render a deep link (the test lane first). Warn instead: the
  // only environments that reach this branch are the ones where nothing
  // interpolates baseHost anyway.
  const baseHost = env.BASE_HOST ?? "";
  if (!baseHost) {
    logger.warn(
      "BASE_HOST is unset — automation dispatch would render deep links (email + Slack alert templates interpolate baseHost) without a host. Set env.BASE_HOST before dispatching alerts.",
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

    // The process-wide analytics singleton — the SAME instance the tRPC and
    // Hono analytics routes get, so the custom-graph threshold evaluator reads
    // through the same 30s timeseries cache rather than warming a second one.
    // Resolved here because resolution is layer 0's job: the adapter that
    // consumes this is `port: (args) => collaborator.method(args)` and nothing
    // else, so it can no longer reach for a locator, and a test can substitute
    // this the way it substitutes every other collaborator.
    analytics: getAnalyticsService(),

    // Composed exactly as the trace pipeline composes its own trace_summaries
    // fold — same cache tier, same key prefix — so the settle confirm reads
    // what that writer wrote (ADR-082 §3).
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
