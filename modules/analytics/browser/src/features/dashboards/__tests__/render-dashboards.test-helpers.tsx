/**
 * Renders a Dashboards component the way the shell does: the analytics host
 * double, and the real tRPC hooks over a transport whose network answers from
 * the test. Nothing in the query layer is mocked.
 */

import type { ChartFrameDashboardContext } from "@langwatch/analytics-contract/chart-frame-protocol";
import { createUiQueryClient } from "@langwatch/browser-host/query-client";
import {
  answeringUiTransport,
  type UiProcedureAnswer,
} from "@langwatch/browser-host/testing-transport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { AnalyticsTestHarness, type StubAnalyticsHost } from "../../../testing.tsx";

/** An answer for a test that expects no procedure to run: any call fails by name. */
export const NO_PROCEDURES: UiProcedureAnswer = ({ path }) =>
  Promise.reject(new Error(`No test answer for ${path}`));

export function renderDashboards({
  element,
  host,
  answer = NO_PROCEDURES,
}: {
  element: ReactElement;
  host: StubAnalyticsHost;
  answer?: UiProcedureAnswer;
}) {
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  const blockQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AnalyticsTestHarness host={host}>
      <analyticsApi.Provider client={answeringUiTransport(answer)} queryClient={queryClient}>
        <QueryClientProvider client={blockQueryClient}>{element}</QueryClientProvider>
      </analyticsApi.Provider>
    </AnalyticsTestHarness>,
  );
}

/** The bridge's first message to a widget frame: what its reserved parameters bind from. */
export type FrameInit = { dashboardContext: ChartFrameDashboardContext };

/**
 * Stands in for the window inside each widget's sandboxed frame, which jsdom
 * cannot run: every widget frame gets a window that records what the bridge
 * sends it. `restore` puts the real `contentWindow` back.
 */
export function recordWidgetFrames() {
  const inits: FrameInit[] = [];
  const prototype = HTMLIFrameElement.prototype;
  const real = Object.getOwnPropertyDescriptor(prototype, "contentWindow");
  const windows = new WeakMap<HTMLIFrameElement, Pick<Window, "postMessage">>();
  Object.defineProperty(prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      const recorded = windows.get(this) ?? {
        postMessage: (message: unknown) => void inits.push(message as FrameInit),
      };
      windows.set(this, recorded);
      return recorded;
    },
  });
  return {
    /** Tells every widget frame on the page it loaded, and answers what each was sent. */
    loadAll: (frames: readonly HTMLElement[]) => {
      for (const frame of frames) fireEvent.load(frame);
      return inits;
    },
    restore: () => {
      if (real) Object.defineProperty(prototype, "contentWindow", real);
    },
  };
}
