/**
 * @vitest-environment node
 * Spec: specs/trace-processing/worker-trace-projection-runtime.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { TraceSpanNormalization } from "../../services/span-normalization.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceIoExtractionAdapterService } from "../../services/trace-io-extraction-adapter.service.ts";
import type { TraceIoExtraction } from "../../services/trace-io-extraction.service.ts";
import type { TraceMediaReferenceResolver } from "../../services/trace-media-reference.service.ts";
import { TraceMediaReferenceService } from "../../services/trace-media-reference.service.ts";
import type { TraceModelCost } from "../../services/trace-model-cost.service.ts";
import { TraceModelCostService } from "../../services/trace-model-cost.service.ts";
import { TraceSpanNormalizationAdapterService } from "../../services/trace-span-normalization-adapter.service.ts";
import type { EventingRecordSpanAdapter } from "../record-span.commands.ts";
import {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "../trace-processing-projections.pipeline.ts";
import { createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

type Options = EventingTracePipelineAdapterOptions;

/** The real adapters, each wrapped so a call to it is written down by name. */
function recordedCollaborators() {
  const calls = new Set<string>();
  const canonicalisation = TraceCanonicalisationService.create();
  const io = TraceIoExtractionAdapterService.create(canonicalisation);
  const media = TraceMediaReferenceService.create();
  const costs = TraceModelCostService.create();
  const normalization = TraceSpanNormalizationAdapterService.create(canonicalisation);

  const ioExtraction: TraceIoExtraction = {
    extractRichIOFromSpan: (span, side) => {
      calls.add("extraction");
      return io.extractRichIOFromSpan(span, side);
    },
    extractFallbackIOFromSpan: (span, side) => {
      calls.add("extraction");
      return io.extractFallbackIOFromSpan(span, side);
    },
  };
  const mediaReferences: TraceMediaReferenceResolver = {
    collect: (value) => {
      calls.add("media references");
      return media.collect(value);
    },
    parse: (serialized) => {
      calls.add("media references");
      return media.parse(serialized);
    },
    merge: (input) => {
      calls.add("media references");
      return media.merge(input);
    },
    serialize: (references) => {
      calls.add("media references");
      return media.serialize(references);
    },
  };
  const modelCosts: TraceModelCost = {
    estimate: (input) => {
      calls.add("cost estimate");
      return costs.estimate(input);
    },
  };
  const spanNormalization: TraceSpanNormalization = {
    normalizeSpanReceived: (input) => {
      calls.add("span normalization");
      return normalization.normalizeSpanReceived(input);
    },
    enrichRagContextIds: (span) => normalization.enrichRagContextIds(span),
  };
  return { calls, canonicalisation, ioExtraction, mediaReferences, modelCosts, spanNormalization };
}

function buildPipeline({
  collaborators,
  prepareEventForProjection,
}: {
  collaborators: ReturnType<typeof recordedCollaborators>;
  prepareEventForProjection: Options["prepareEventForProjection"];
}) {
  return EventingTracePipelineAdapter.create({
    spanStore: createApiFixture<Options["spanStore"]>(),
    summaryStore: createApiFixture<Options["summaryStore"]>(),
    derivedStore: createApiFixture<Options["derivedStore"]>(),
    rollupStore: createApiFixture<Options["rollupStore"]>(),
    canonicalisation: collaborators.canonicalisation,
    ioExtraction: collaborators.ioExtraction,
    mediaReferences: collaborators.mediaReferences,
    modelCosts: collaborators.modelCosts,
    spanNormalization: collaborators.spanNormalization,
    prepareEventForProjection,
    recordSpanCommand: createApiFixture<EventingRecordSpanAdapter>(),
  })
    .build()
    .build();
}

const LLM_SPAN = {
  "langwatch.input": "what is the capital of France?",
  "langwatch.output": "Paris",
  "gen_ai.request.model": "gpt-5-mini",
  "gen_ai.usage.input_tokens": 12,
  "gen_ai.usage.output_tokens": 3,
};

describe("the trace processing pipeline built from handed collaborators", () => {
  describe("when the registered projections handle a span", () => {
    /** @scenario the composed pipeline actually uses the collaborators it was given */
    it("runs the extraction, media references, cost estimate and payload preparation it was handed", () => {
      const collaborators = recordedCollaborators();
      const prepare: Options["prepareEventForProjection"] = (event: TraceProcessingEvent) => event;
      const definition = buildPipeline({ collaborators, prepareEventForProjection: prepare });
      const event = createSpanReceivedEvent({ attributes: LLM_SPAN });

      const summary = definition.foldProjections.get("traceSummary");
      const spanStorage = definition.mapProjections.get("spanStorage");
      if (!summary || !spanStorage)
        throw new Error("the pipeline registered no summary or span projection");
      summary.open((fold) => fold.apply(fold.init(), event));
      spanStorage.open((projection, consumes) => (consumes(event) ? projection.map(event) : null));

      expect([...collaborators.calls].toSorted()).toEqual([
        "cost estimate",
        "extraction",
        "media references",
        "span normalization",
      ]);
      expect(Object.is(definition.prepareEventForProjection, prepare)).toBe(true);
    });
  });
});
