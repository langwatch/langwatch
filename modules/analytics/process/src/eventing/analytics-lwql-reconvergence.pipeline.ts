import type { AnalyticsApi } from "@langwatch/analytics-contract";
/**
 * The access-model reconvergence watch as a scheduled process with no events of its own.
 * `global`, because one ClickHouse access model serves every tenant (ADR-159).
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";
import {
  LWQL_RECONVERGENCE_PROCESS_NAME,
  runLwqlReconvergence,
} from "./analytics-lwql-reconvergence.intent.ts";
import {
  LWQL_RECONVERGENCE_INITIAL_DELAY_MS,
  LWQL_RECONVERGENCE_INITIAL_STATE,
  type LwqlReconvergenceState,
  lwqlReconvergenceSchema,
  lwqlReconvergenceWake,
} from "./analytics-lwql-reconvergence.process.ts";

export const LWQL_RECONVERGENCE_PIPELINE_NAME = "lwql_reconvergence";

/** The two operations the watch calls; absent LangWatchQL or rendered mode, both are no-ops. */
export interface LwqlReconvergenceApp {
  probeLwqlAccessModelOwner(): Promise<LwqlAccessModelOwner>;
  convergeLwqlAccessModel(): Promise<void>;
}

export function buildLwqlReconvergence({
  app,
  bootedAt = nowInstant().epochMilliseconds,
}: {
  app: LwqlReconvergenceApp;
  bootedAt?: number;
}): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: LWQL_RECONVERGENCE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(LWQL_RECONVERGENCE_PROCESS_NAME, (pm) =>
      pm
        .state<LwqlReconvergenceState>(LWQL_RECONVERGENCE_INITIAL_STATE)
        .schedule({ everyMs: LWQL_RECONVERGENCE_INITIAL_DELAY_MS })
        .onWake(lwqlReconvergenceWake({ bootedAt }))
        .intent(
          "reconverge",
          lwqlReconvergenceSchema,
          runLwqlReconvergence({
            probe: () => app.probeLwqlAccessModelOwner(),
            converge: () => app.convergeLwqlAccessModel(),
          }),
        )
        // One convergence at a time; a retry repeats a probe, which is idempotent.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();
}

function isReconvergenceApp(app: unknown): app is LwqlReconvergenceApp {
  return (
    typeof app === "object" &&
    app !== null &&
    "probeLwqlAccessModelOwner" in app &&
    "convergeLwqlAccessModel" in app
  );
}

/** Narrowed to the constructed app, as the licensing transport facts do, not the contract. */
export const lwqlReconvergenceEventing = defineEventingModule({
  pipeline: LWQL_RECONVERGENCE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<unknown, AnalyticsApi>) => {
    if (!isReconvergenceApp(app)) {
      throw new TypeError(
        "The LangWatchQL reconvergence watch requires the constructed analytics app",
      );
    }
    return buildLwqlReconvergence({ app });
  },
});
