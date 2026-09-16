import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import { SuiteRunCommandsAdapter } from "./suite-run-commands.service.ts";
import { SuiteRunStateFoldProjection } from "../eventing/suite-run-state.projection.ts";
import { SUITE_RUN_PROCESSING_EVENT_TYPES } from "@langwatch/suite-contract";
import type { SuiteRunProcessingEvent } from "@langwatch/suite-contract";

export interface SuiteRunProcessingPipelineDeps {
  suiteRunStateFoldStore: FoldProjectionStore<SuiteRunStateData>;
}

/**
 * How long a suite command's job id stays claimed.
 */
const SUITE_COMMAND_DEDUP_TTL_MS = 60_000;

/**
 * The command's own job id, required at this seam rather than optional.
 */
function requireJobId<TPayload>(
  commandName: string,
  makeJobId: ((payload: TPayload) => string) | undefined,
): (payload: TPayload) => string {
  if (!makeJobId) {
    throw new Error(
      `Suite command "${commandName}" is registered with deduplication but defines no makeJobId`,
    );
  }
  return makeJobId;
}

/**
 * Creates the suite run processing pipeline definition.
 */
export class SuiteRunProcessingPipelineAdapter {
  static create(deps: SuiteRunProcessingPipelineDeps) {
    const commands = SuiteRunCommandsAdapter.create();

    return (
      definePipeline<SuiteRunProcessingEvent>({
        name: "suite_run_processing",
        aggregate: defineAggregate({
          type: "suite_run",
          events: defineEvents(SUITE_RUN_PROCESSING_EVENT_TYPES),
        }),
      })
        .withClickHouseFoldProjection(
          SuiteRunStateFoldProjection.create({
            store: deps.suiteRunStateFoldStore,
          }),
        )
        // These three fold by addition (Started/Completed/FailedCount + 1),
        // deduped by `event.id` — `withCommand` only reads dedup from
        // `makeJobId` in these options; omit it and a redelivery double-counts,
        // flipping status to SUCCESS/FAILURE before the run has finished.
        .withCommand("startSuiteRun", commands.startSuiteRun, {
          deduplication: {
            makeId: requireJobId("startSuiteRun", commands.startSuiteRun.makeJobId),
            ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
          },
        })
        .withCommand("recordSuiteRunItemStarted", commands.recordSuiteRunItemStarted, {
          deduplication: {
            makeId: requireJobId(
              "recordSuiteRunItemStarted",
              commands.recordSuiteRunItemStarted.makeJobId,
            ),
            ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
          },
        })
        .withCommand("completeSuiteRunItem", commands.completeSuiteRunItem, {
          deduplication: {
            makeId: requireJobId("completeSuiteRunItem", commands.completeSuiteRunItem.makeJobId),
            ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
          },
        })
        .build()
    );
  }

  private constructor() {}
}

/**
 * The definition this feature registers, named so a composition root can hold
 * one without restating its shape.
 */
export type SuiteRunProcessingPipeline = ReturnType<
  typeof SuiteRunProcessingPipelineAdapter.create
>;
