import type { AnalyticsApi } from "@langwatch/analytics-contract";
/**
 * Analytics' LangWatchQL pipeline, with no events of its own: the reconvergence check, `global`
 * because one ClickHouse access model serves every tenant (ADR-159), and the key-map row it
 * writes when project records a created project (§9).
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

import type { LwqlAppOwnedDrift } from "../features/provisioning/services/langwatch-ql-self-provisioning.service.ts";
import type { AnalyticsRepositories } from "../repositories/analytics.repositories.ts";
import type { LwqlUnconfirmedSinceRepository } from "../repositories/langwatch-ql-unconfirmed-since.repository.ts";
import type { LwqlAccessModelOwner } from "../rules/langwatch-ql-config-store.rules.ts";
import {
  LWQL_RECONVERGENCE_PROCESS_NAME,
  runLwqlReconvergence,
} from "./analytics-lwql-reconvergence.intent.ts";
import {
  LWQL_KEY_MAP_FILL_MAX_ATTEMPTS,
  LWQL_RECONVERGENCE_INITIAL_STATE,
  LWQL_RECONVERGENCE_INTERVAL_MS,
  lwqlKeyMapFillRetryDelayMs,
  lwqlReconvergenceStateSchema,
  lwqlReconvergenceSchema,
  lwqlReconvergenceWake,
} from "./analytics-lwql-reconvergence.process.ts";

const LWQL_RECONVERGENCE_PIPELINE_NAME = "lwql_reconvergence";

/** The operations this pipeline calls; absent LangWatchQL, all are no-ops. */
interface LwqlReconvergenceApp {
  probeLwqlAccessModelOwner(): Promise<LwqlAccessModelOwner>;
  convergeLwqlAccessModel(): Promise<void>;
  findLwqlAppOwnedDrift(): Promise<LwqlAppOwnedDrift>;
  convergeLwqlAppOwnedObjects(drift: LwqlAppOwnedDrift): Promise<void>;
  syncLwqlKeyMapRow(input: { projectId: string }): Promise<void>;
  fillLwqlProjectKeys(input: { dryRun: boolean }): Promise<unknown>;
}

export function buildLwqlReconvergence({
  app,
  unconfirmedSince,
}: {
  app: LwqlReconvergenceApp;
  /** Shared by the fleet, so the unconfirmed-collection alert waits on time, not on one worker. */
  unconfirmedSince: LwqlUnconfirmedSinceRepository;
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
        .schedule({ everyMs: LWQL_RECONVERGENCE_INTERVAL_MS })
        .onWake(lwqlReconvergenceWake)
        .intent(
          "reconverge",
          lwqlReconvergenceSchema,
          runLwqlReconvergence({
            probe: () => app.probeLwqlAccessModelOwner(),
            converge: () => app.convergeLwqlAccessModel(),
            findDrift: () => app.findLwqlAppOwnedDrift(),
            convergeAppOwned: (drift) => app.convergeLwqlAppOwnedObjects(drift),
            fillKeyMap: () => app.fillLwqlProjectKeys({ dryRun: false }),
            unconfirmedSince,
          }),
        )
        // One check at a time. Only a failed key-map fill throws: its check is delivered again
        // with backoff, ending before the wake asks for a fill anew a day later.
        .outbox({
          maxAttempts: LWQL_KEY_MAP_FILL_MAX_ATTEMPTS,
          retryDelayMs: lwqlKeyMapFillRetryDelayMs,
          concurrency: 1,
          batchSize: 1,
          leaseDurationMs: 10 * 60 * 1000,
        }),
    )
    .build();
}

function isReconvergenceApp(app: unknown): app is LwqlReconvergenceApp {
  return (
    typeof app === "object" &&
    app !== null &&
    "probeLwqlAccessModelOwner" in app &&
    "convergeLwqlAccessModel" in app &&
    "findLwqlAppOwnedDrift" in app &&
    "convergeLwqlAppOwnedObjects" in app &&
    "syncLwqlKeyMapRow" in app &&
    "fillLwqlProjectKeys" in app
  );
}

/** Narrowed to the constructed app, as licensing's middleware bindings do, not the contract. */
export const lwqlReconvergenceEventing = defineEventingModule({
  pipeline: LWQL_RECONVERGENCE_PIPELINE_NAME,
  build: ({ app, repositories }: EventingSetup<AnalyticsRepositories, AnalyticsApi>) => {
    if (!isReconvergenceApp(app)) {
      throw new TypeError(
        "The LangWatchQL reconvergence watch requires the constructed analytics app",
      );
    }
    return buildLwqlReconvergence({
      app,
      unconfirmedSince: repositories.langWatchQl.unconfirmedSince,
    });
  },
});
