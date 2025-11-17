# Files Still Using Sentry

Here are all the files that still need to be migrated from Sentry to PostHog:

## API Routes (pages/api/)
- ✅ `pages/api/cron/triggers.ts` - DONE
- ✅ `pages/api/collector.ts` - DONE
- ✅ `pages/api/evaluations/batch/log_results.ts` - DONE
- ⏳ `pages/api/cron/trace_analytics.ts`
- ⏳ `pages/api/evaluations/[evaluator]/[subpath]/evaluate.ts`
- ⏳ `pages/api/dspy/log_steps.ts`
- ⏳ `pages/api/dataset/evaluate.ts`
- ⏳ `pages/api/track_event.ts`
- ⏳ `pages/api/track_usage.ts`
- ⏳ `pages/api/experiment/init.ts`

## App Router API Routes (app/api/)
- ⏳ `app/api/otel/v1/traces/route.ts`
- ⏳ `app/api/otel/v1/logs/route.ts`
- ⏳ `app/api/otel/v1/metrics/route.ts`
- ⏳ `app/api/workflows/post_event/route.ts`
- ⏳ `app/api/workflows/post_event/post-event.ts`
- ⏳ `app/api/scenario-events/[[...route]]/scenario-event.repository.ts`
- ⏳ `app/global-error.tsx`

## Server Files
- ⏳ `server/auth.ts`
- ⏳ `server/api/routers/datasetRecord.ts`
- ⏳ `server/api/routers/onboarding/onboarding.router.ts`
- ⏳ `server/api/trpc.ts`
- ⏳ `server/triggers/sendSlackWebhook.ts`
- ⏳ `server/background/workers/evaluationsWorker.ts`
- ⏳ `server/background/workers/usageStatsWorker.ts`
- ⏳ `server/background/workers/trackEventsWorker.ts`
- ⏳ `server/background/workers/topicClusteringWorker.ts`
- ⏳ `server/background/workers/collector/cost.ts`
- ⏳ `server/background/workers/collector/piiCheck.ts`

## Client Components
- ⏳ `pages/settings/members.tsx`
- ⏳ `pages/[project]/index.tsx`
- ⏳ `pages/invite/accept.tsx`
- ⏳ `components/evaluations/wizard/hooks/useAutosaveWizard.tsx`
- ⏳ `components/evaluations/wizard/steps/datasets/DatasetGeneration.tsx`

## Utils
- ⏳ `utils/truncate.ts`

## Other
- ⏳ `optimization_studio/server/lambda.ts`

## Replacement Pattern

For each file:

1. **Replace import:**
   ```typescript
   // Before:
   import * as Sentry from "@sentry/nextjs";
   // or
   import * as Sentry from "@sentry/node";
   
   // After:
   import { captureException } from "~/utils/posthogErrorCapture";
   // Add if needed:
   import { withScope, startSpan, getCurrentScope } from "~/utils/posthogErrorCapture";
   ```

2. **Replace calls:**
   ```typescript
   // Before:
   Sentry.captureException(error, { extra: {...} });
   
   // After:
   captureException(error, { extra: {...} });
   ```

3. **For withScope:**
   ```typescript
   // Before:
   Sentry.withScope((scope) => {
     scope.setTag("key", "value");
     Sentry.captureException(error);
   });
   
   // After:
   withScope((scope) => {
     scope.setTag?.("key", "value");
     captureException(error);
   });
   ```

4. **For startSpan:**
   ```typescript
   // Before:
   await Sentry.startSpan({ name: "..." }, async () => { ... });
   
   // After:
   await startSpan({ name: "..." }, async () => { ... });
   ```

