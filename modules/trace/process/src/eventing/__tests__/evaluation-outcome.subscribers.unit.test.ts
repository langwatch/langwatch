/** Spec: specs/trace/trace-evaluation-analytics.feature */
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_TYPE,
} from "@langwatch/evaluation-contract";
import type { EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { EVALUATED_TRACE_SETTLE_MS } from "../../rules/trace-evaluation-analytics.rules.ts";
import type { EventingRecordSpanAdapter } from "../record-span.commands.ts";
import {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "../trace-processing-projections.pipeline.ts";

type Options = EventingTracePipelineAdapterOptions;
type Definition = ReturnType<EventingTracePipelineAdapter["build"]>;
type Registry = Parameters<NonNullable<Definition["globalProjections"]>[number]["register"]>[0];

/** Every peer subscriber the trace pipeline registers, as the registry receives it. */
function registeredPeerSubscribers(): EventSubscriberDefinition<never>[] {
  const definition = EventingTracePipelineAdapter.create({
    spanStore: createApiFixture<Options["spanStore"]>(),
    summaryStore: createApiFixture<Options["summaryStore"]>(),
    derivedStore: createApiFixture<Options["derivedStore"]>(),
    rollupStore: createApiFixture<Options["rollupStore"]>(),
    spanAnalyticsStore: createApiFixture<Options["spanAnalyticsStore"]>(),
    canonicalisation: TraceCanonicalisationService.create(),
    ioExtraction: createApiFixture<Options["ioExtraction"]>(),
    mediaReferences: createApiFixture<Options["mediaReferences"]>(),
    modelCosts: createApiFixture<Options["modelCosts"]>(),
    spanNormalization: createApiFixture<Options["spanNormalization"]>(),
    prepareEventForProjection: (event) => event,
    recordSpanCommand: createApiFixture<EventingRecordSpanAdapter>(),
  }).build();
  const registered: EventSubscriberDefinition<never>[] = [];
  const registry = createApiFixture<Registry>({
    registerEventSubscriber: (subscriber) => void registered.push(subscriber),
  });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);
  return registered;
}

describe("the trace pipeline's evaluation outcome subscribers", () => {
  /** @scenario "The trace subscriber waits for the trace to settle before its first attempt" */
  it("delays each first delivery by the 30-second trace settle window", () => {
    const outcomeLanes = registeredPeerSubscribers().filter(({ eventTypes }) =>
      eventTypes?.some(
        (type) =>
          type === EVALUATION_COMPLETED_EVENT_TYPE || type === EVALUATION_REPORTED_EVENT_TYPE,
      ),
    );

    expect(EVALUATED_TRACE_SETTLE_MS).toBe(30_000);
    expect(outcomeLanes.map(({ name, options }) => [name, options?.delay])).toEqual([
      ["trace_processing.evaluationCompletedOutcome", 30_000],
      ["trace_processing.evaluationReportedOutcome", 30_000],
    ]);
  });
});
