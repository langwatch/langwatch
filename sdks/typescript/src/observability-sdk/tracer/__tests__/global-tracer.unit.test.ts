import { createRequire } from "node:module";

import type * as OtelApi from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it } from "vitest";

import { getLangWatchTracer } from "..";

/** The CommonJS build of the api: 1.10 ships it apart from the ESM build these sources import. */
const commonJsApi = createRequire(__filename)("@opentelemetry/api") as typeof OtelApi;

describe("getLangWatchTracer()", () => {
  afterEach(() => {
    commonJsApi.trace.disable();
  });

  describe("when the tracer is taken before any provider is registered", () => {
    describe("and the provider is registered through the api's other module build", () => {
      /** @scenario "A tracer taken before the provider is registered records through either api build" */
      it("records spans on the registered provider", () => {
        const tracer = getLangWatchTracer("early-tracer");
        const exporter = new InMemorySpanExporter();
        commonJsApi.trace.setGlobalTracerProvider(
          new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] }),
        );

        tracer.startSpan("after-registration").end();
        tracer.withActiveSpan("active-after-registration", () => undefined);

        expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
          "after-registration",
          "active-after-registration",
        ]);
      });
    });
  });
});
