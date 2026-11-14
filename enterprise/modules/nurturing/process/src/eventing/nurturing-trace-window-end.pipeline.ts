// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's hourly sweep ending organizations' trace windows (see the process file). Without a
 * Customer.io channel nothing is sent, so the pipeline holds no process.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { NurturingModule } from "../app/nurturing.app.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import {
  runTraceWindowEnd,
  TRACE_WINDOW_END_INTERVAL_MS,
  TRACE_WINDOW_END_PROCESS_NAME,
  type TraceWindowEndRunDeps,
  traceWindowEndStateSchema,
  traceWindowEndSweepSchema,
  traceWindowEndWake,
} from "./nurturing-trace-window-end.process.ts";

export const NURTURING_TRACE_WINDOW_END_PIPELINE_NAME = "nurturing_trace_window_end" as const;

/** Each organization's sends are a few calls; an hour's new organizations fit one lease. */
const SWEEP_LEASE_MS = 10 * 60 * 1000;

function nurturingTraceWindowEndHost(deps: Omit<TraceWindowEndRunDeps, "now"> | undefined) {
  const host = definePipeline({
    name: NURTURING_TRACE_WINDOW_END_PIPELINE_NAME,
    // `global`, like the other maintenance pipelines: no events, and it spans every tenant.
    aggregate: defineAggregate({ type: "global" }),
  }).withEvents([]);
  if (!deps) return host;
  return host.withProcessManager(TRACE_WINDOW_END_PROCESS_NAME, (pm) =>
    pm
      .state(traceWindowEndStateSchema, { lastSweepAt: null })
      .schedule({ everyMs: TRACE_WINDOW_END_INTERVAL_MS })
      .onWake(traceWindowEndWake)
      .intent(
        "sweep",
        traceWindowEndSweepSchema,
        runTraceWindowEnd({ ...deps, now: () => nowInstant().epochMilliseconds }),
      )
      .outbox({ leaseDurationMs: SWEEP_LEASE_MS, concurrency: 1, batchSize: 1 }),
  );
}

/** The pipeline as a TYPE, derived from the builder above. */
export type NurturingTraceWindowEndPipeline = ReturnType<
  ReturnType<typeof nurturingTraceWindowEndHost>["build"]
>;

export function buildNurturingTraceWindowEndPipeline(
  deps: Omit<TraceWindowEndRunDeps, "now"> | undefined,
): NurturingTraceWindowEndPipeline {
  return nurturingTraceWindowEndHost(deps).build();
}

export const nurturingTraceWindowEndEventing = defineEventingModule({
  pipeline: NURTURING_TRACE_WINDOW_END_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<NurturingRepositories, NurturingModule>) =>
    buildNurturingTraceWindowEndPipeline(
      app.syncsOrganizationUsage()
        ? {
            traceWindowsEnded: (input) => app.organizationTraceWindowsEnded(input),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }
        : undefined,
    ),
});
