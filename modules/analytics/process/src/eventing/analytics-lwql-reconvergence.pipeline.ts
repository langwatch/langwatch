import type { AnalyticsApi } from "@langwatch/analytics-contract";
/**
 * Analytics' LangWatchQL pipeline, with no events of its own: the access-model reconvergence
 * watch, `global` because one ClickHouse access model serves every tenant (ADR-159), and the
 * key-map row it writes when project records a created project (§9).
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import type { AnalyticsRepositories } from "../repositories/analytics.repositories.ts";
import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";
import {
  LWQL_RECONVERGENCE_PROCESS_NAME,
  runLwqlReconvergence,
} from "./analytics-lwql-reconvergence.intent.ts";
import {
  LWQL_RECONVERGENCE_INITIAL_DELAY_MS,
  LWQL_RECONVERGENCE_INITIAL_STATE,
  lwqlReconvergenceStateSchema,
  lwqlReconvergenceSchema,
  lwqlReconvergenceWake,
} from "./analytics-lwql-reconvergence.process.ts";

const LWQL_RECONVERGENCE_PIPELINE_NAME = "lwql_reconvergence";

/** The operations this pipeline calls; absent LangWatchQL or rendered mode, all are no-ops. */
interface LwqlReconvergenceApp {
  probeLwqlAccessModelOwner(): Promise<LwqlAccessModelOwner>;
  convergeLwqlAccessModel(): Promise<void>;
  syncLwqlKeyMapRow(input: { projectId: string }): Promise<void>;
}

export function buildLwqlReconvergence({
  app,
  bootedAt = nowInstant().epochMilliseconds,
}: {
  app: LwqlReconvergenceApp;
  bootedAt?: number;
}): StaticPipelineDefinition<never> {
  return definePipeline({
    name: LWQL_RECONVERGENCE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("syncLwqlKeyMapRow", {
      eventType: PROJECT_CREATED_EVENT_TYPE,
      data: projectCreatedEventDataSchema,
      handle: ({ projectId }) => app.syncLwqlKeyMapRow({ projectId }),
    })
    .withProcessManager(LWQL_RECONVERGENCE_PROCESS_NAME, (pm) =>
      pm
        .state(lwqlReconvergenceStateSchema, LWQL_RECONVERGENCE_INITIAL_STATE)
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
    "convergeLwqlAccessModel" in app &&
    "syncLwqlKeyMapRow" in app
  );
}

/** Narrowed to the constructed app, as the licensing transport facts do, not the contract. */
export const lwqlReconvergenceEventing = defineEventingModule({
  pipeline: LWQL_RECONVERGENCE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AnalyticsRepositories, AnalyticsApi>) => {
    if (!isReconvergenceApp(app)) {
      throw new TypeError(
        "The LangWatchQL reconvergence watch requires the constructed analytics app",
      );
    }
    return buildLwqlReconvergence({ app });
  },
});
