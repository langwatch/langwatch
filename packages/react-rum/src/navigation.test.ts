/**
 * @vitest-environment jsdom
 *
 * Exercises real spans through a real provider and reads what came out the
 * other end: parentage is the whole point here, and a mock of the tracer would
 * assert the calls we made rather than the trace we produced.
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_HTTP_ROUTE,
  ATTR_URL_PATH,
} from "@opentelemetry/semantic-conventions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ATTR_NAVIGATION_FROM_PATH,
  ATTR_NAVIGATION_SUPERSEDED,
  ATTR_NAVIGATION_TYPE,
  RUM_INSTRUMENTATION_NAME,
} from "./constants";
import { resetNavigationForTesting, startNavigationSpan } from "./navigation";
import { NavigationContextManager } from "./navigationContextManager";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager = new NavigationContextManager();

/** A span opened the way the fetch instrumentation opens one: no explicit parent. */
const openAmbientSpan = (name: string): void => {
  trace.getTracer("test").startSpan(name).end();
};

const exported = (name: string): ReadableSpan | undefined =>
  exporter.getFinishedSpans().find((span) => span.name === name);

beforeEach(() => {
  exporter.reset();
  resetNavigationForTesting();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => {
  context.disable();
  trace.disable();
});

describe("startNavigationSpan", () => {
  describe("given the user navigates to another page", () => {
    describe("when the route commits", () => {
      /** scenario "Navigating between pages is visible as work" */
      it("reports the navigation as a span named for the route", () => {
        const navigation = startNavigationSpan({
          toPath: "/acme/traces/trace_abc",
          fromPath: "/acme/home",
        });
        navigation.commit({ route: "/:project/traces/:traceId" });
        navigation.end();

        const span = exported("navigation /:project/traces/:traceId");
        expect(span).toBeDefined();
        expect(span?.attributes[ATTR_HTTP_ROUTE]).toBe(
          "/:project/traces/:traceId",
        );
        expect(span?.attributes[ATTR_URL_PATH]).toBe("/acme/traces/trace_abc");
        expect(span?.attributes[ATTR_NAVIGATION_FROM_PATH]).toBe("/acme/home");
        expect(span?.attributes[ATTR_NAVIGATION_TYPE]).toBe("resolved");
        expect(span?.instrumentationScope.name).toBe(RUM_INSTRUMENTATION_NAME);
      });
    });

    describe("when the page it opens calls the server", () => {
      /** scenario "Navigating between pages is visible as work" */
      it("puts the call beneath the navigation, across the async gap", async () => {
        const navigation = startNavigationSpan({ toPath: "/acme/traces" });
        navigation.commit({ route: "/:project/traces" });

        // The gap the StackContextManager cannot bridge: the page mounts and
        // its queries dispatch in a later task, not in the navigating stack.
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        openAmbientSpan("GET /api/trpc/traces.getAll");

        navigation.end();

        const call = exported("GET /api/trpc/traces.getAll");
        const nav = exported("navigation /:project/traces");
        expect(call?.parentSpanContext?.spanId).toBe(nav?.spanContext().spanId);
        expect(call?.spanContext().traceId).toBe(nav?.spanContext().traceId);
      });
    });

    describe("when the navigation has settled", () => {
      it("stops adopting later work", () => {
        const navigation = startNavigationSpan({ toPath: "/acme/traces" });
        navigation.commit({ route: "/:project/traces" });
        navigation.end();

        openAmbientSpan("GET /api/trpc/poll");

        expect(
          exported("GET /api/trpc/poll")?.parentSpanContext,
        ).toBeUndefined();
      });
    });
  });

  describe("given a span is already active", () => {
    describe("when a navigation-triggered call is made inside it", () => {
      it("keeps the parent it already has", () => {
        const navigation = startNavigationSpan({ toPath: "/acme/traces" });
        const outer = trace.getTracer("test").startSpan("outer");

        context.with(trace.setSpan(ROOT_CONTEXT, outer), () => {
          openAmbientSpan("inner");
        });
        outer.end();
        navigation.end();

        expect(exported("inner")?.parentSpanContext?.spanId).toBe(
          outer.spanContext().spanId,
        );
      });
    });
  });

  describe("given the user navigates away mid-navigation", () => {
    describe("when the second navigation starts", () => {
      it("marks the abandoned one rather than leaving it looking fast", () => {
        const first = startNavigationSpan({ toPath: "/acme/traces" });
        const second = startNavigationSpan({ toPath: "/acme/datasets" });
        second.commit({ route: "/:project/datasets" });
        second.end();
        // The abandoned navigation's own teardown arrives late and must not
        // withdraw the successor that replaced it.
        first.end();

        expect(
          exported("navigation /acme/traces")?.attributes[
            ATTR_NAVIGATION_SUPERSEDED
          ],
        ).toBe(true);
        expect(exported("navigation /:project/datasets")).toBeDefined();
      });
    });

    describe("when work starts after the successor took over", () => {
      it("attributes it to the successor", () => {
        const first = startNavigationSpan({ toPath: "/acme/traces" });
        const second = startNavigationSpan({ toPath: "/acme/datasets" });
        first.end();

        openAmbientSpan("GET /api/trpc/datasets.getAll");
        second.end();

        expect(
          exported("GET /api/trpc/datasets.getAll")?.parentSpanContext?.spanId,
        ).toBe(exported("navigation /acme/datasets")?.spanContext().spanId);
      });
    });
  });

  describe("given a navigation that never commits", () => {
    describe("when it ends", () => {
      it("still closes out rather than leaking the ambient parent", () => {
        startNavigationSpan({ toPath: "/acme/traces" }).end();

        openAmbientSpan("GET /api/trpc/poll");

        expect(exported("navigation /acme/traces")).toBeDefined();
        expect(
          exported("GET /api/trpc/poll")?.parentSpanContext,
        ).toBeUndefined();
      });
    });
  });
});
