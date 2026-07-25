/**
 * @vitest-environment jsdom
 *
 * Integration test for the router half of browser navigation spans.
 *
 * Spec: specs/observability/browser-rum-trace-correlation.feature
 * ADR: dev/docs/adr/058-full-stack-trace-correlation-browser-rum.md
 *
 * The router is REAL — a memory data router with a lazy child route, so a
 * navigation genuinely passes through `loading` before it commits, which is
 * the transition the hook keys off. The OpenTelemetry provider is real too,
 * exporting in memory: what is asserted is the trace that came out, not the
 * calls that were made. Only `usePublicEnv` is mocked, because it is the flag
 * boundary and reaching it would need a tRPC client.
 */
import { act, cleanup, render } from "@testing-library/react";
import { context, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_HTTP_ROUTE, ATTR_URL_PATH } from "@opentelemetry/semantic-conventions";
import {
  createMemoryRouter,
  Outlet,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationContextManager } from "@langwatch/react-rum";
import { useNavigationTracing } from "../useNavigationTracing";

const publicEnv = { RUM_ENABLED: true };
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnv }),
}));


const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager = new NavigationContextManager();

/** A call the way the fetch instrumentation makes one: started with no parent. */
const callServer = (name: string) => {
  trace.getTracer("test").startSpan(name).end();
};

const exported = (name: string): ReadableSpan | undefined =>
  exporter.getFinishedSpans().find((span) => span.name === name);

const navigationSpans = (): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((s) => s.name.startsWith("navigation "));

function Layout() {
  useNavigationTracing();
  return <Outlet />;
}

/** Lets a test hold a route in its loading state and release it on demand. */
let releaseLazyRoute: (() => void) | null = null;

const routes: RouteObject[] = [
  {
    path: "/",
    Component: Layout,
    children: [
      { path: ":project/home", Component: () => <div>home</div> },
      {
        path: ":project/traces/:traceId",
        lazy: async () => {
          await new Promise<void>((resolve) => {
            releaseLazyRoute = resolve;
          });
          return { Component: () => <div>trace</div> };
        },
      },
      { path: ":project/datasets", Component: () => <div>datasets</div> },
    ],
  },
];

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
};

/** Runs out the settle window so the navigation span closes. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  exporter.reset();
  releaseLazyRoute = null;
  publicEnv.RUM_ENABLED = true;
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => {
  cleanup();
  context.disable();
  trace.disable();
});

describe("useNavigationTracing", () => {
  describe("given a visit that has just loaded a page", () => {
    describe("when nothing has been navigated to yet", () => {
      /**
       * The document load is already a span of its own; a second one for the
       * same arrival would double-count it.
       */
      it("reports no navigation", async () => {
        renderAt("/acme/home");
        await settle();

        expect(navigationSpans()).toHaveLength(0);
      });
    });
  });

  describe("given the user navigates to another page", () => {
    describe("when the route has to be fetched before it renders", () => {
      /** scenario "Navigating between pages is visible as work" */
      it("reports the navigation named for the route it opened", async () => {
        const router = renderAt("/acme/home");

        const navigating = act(async () => {
          void router.navigate("/acme/traces/trace_abc");
          await Promise.resolve();
        });
        await navigating;
        await act(async () => {
          releaseLazyRoute?.();
          await Promise.resolve();
        });
        await settle();

        const span = exported("navigation /:project/traces/:traceId");
        expect(span).toBeDefined();
        expect(span?.attributes[ATTR_HTTP_ROUTE]).toBe(
          "/:project/traces/:traceId",
        );
        expect(span?.attributes[ATTR_URL_PATH]).toBe("/acme/traces/trace_abc");
      });
    });

    describe("when the page it opened calls the server", () => {
      /** scenario "Navigating between pages is visible as work" */
      it("puts the call beneath the navigation", async () => {
        const router = renderAt("/acme/home");

        await act(async () => {
          void router.navigate("/acme/traces/trace_abc");
          await Promise.resolve();
        });
        await act(async () => {
          releaseLazyRoute?.();
          await Promise.resolve();
        });

        // The page has mounted and its queries dispatch — before the settle
        // window closes, but long after the navigating stack unwound.
        callServer("GET /api/trpc/traces.getById");
        await settle();

        const call = exported("GET /api/trpc/traces.getById");
        const navigation = exported("navigation /:project/traces/:traceId");
        expect(call?.parentSpanContext?.spanId).toBe(
          navigation?.spanContext().spanId,
        );
      });
    });

    describe("when the route was already loaded", () => {
      it("still reports the navigation", async () => {
        const router = renderAt("/acme/home");

        await act(async () => {
          await router.navigate("/acme/datasets");
        });
        await settle();

        expect(exported("navigation /:project/datasets")).toBeDefined();
      });
    });

    describe("when the page has settled and a background call is made", () => {
      /** scenario "Work well after a navigation is not attributed to it" */
      it("leaves that call out of the navigation", async () => {
        const router = renderAt("/acme/home");

        await act(async () => {
          await router.navigate("/acme/datasets");
        });
        await settle();

        callServer("GET /api/trpc/poll");

        expect(exported("GET /api/trpc/poll")?.parentSpanContext).toBeUndefined();
      });
    });
  });

  describe("given browser telemetry is disabled", () => {
    describe("when the user navigates", () => {
      /** scenario "Telemetry is silent when disabled" */
      it("reports nothing", async () => {
        publicEnv.RUM_ENABLED = false;
        const router = renderAt("/acme/home");

        await act(async () => {
          await router.navigate("/acme/datasets");
        });
        await settle();

        expect(navigationSpans()).toHaveLength(0);
      });
    });
  });
});
