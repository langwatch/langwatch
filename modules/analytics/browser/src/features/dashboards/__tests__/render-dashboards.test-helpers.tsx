/**
 * Renders a Dashboards component the way the shell does: the analytics host
 * double, and the real tRPC hooks over a transport whose network answers from
 * the test. Nothing in the query layer is mocked.
 */

import type { ChartFrameDashboardContext } from "@langwatch/analytics-contract/chart-frame-protocol";
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import {
  createUiHostServicesFromHost,
  RecordingUiAnalytics,
} from "@langwatch/browser-host/testing";
import { createUiQueryClient } from "@langwatch/browser/query-client";
import { answeringUiTransport, type UiProcedureAnswer } from "@langwatch/browser/testing-transport";
import { DEFAULT_DASHBOARD_HOME_PRODUCT } from "@langwatch/dashboard-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { AnalyticsTestHarness, type StubAnalyticsHost } from "../../../testing.tsx";

/** What a board row carries when the project in view ("proj-1") owns it: LLM Ops, at Project. */
export const HOME_BOARD = {
  projectId: "proj-1",
  scope: "PROJECT",
  homeProduct: DEFAULT_DASHBOARD_HOME_PRODUCT,
  organizationId: null,
  ownerProject: null,
} as const;

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

export { RecordingUiAnalytics };

/** Puts a recording destination above the element, through the real host-service seam. */
export function withAnalytics(element: ReactElement, analytics: RecordingUiAnalytics) {
  const services = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    analytics,
  };
  return <UiHostServicesContextProvider value={services}>{element}</UiHostServicesContextProvider>;
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
  const perFrame = new Map<HTMLIFrameElement, ChartFrameDashboardContext>();
  const prototype = HTMLIFrameElement.prototype;
  const real = Object.getOwnPropertyDescriptor(prototype, "contentWindow");
  const windows = new WeakMap<HTMLIFrameElement, Pick<Window, "postMessage">>();
  Object.defineProperty(prototype, "contentWindow", {
    configurable: true,
    get(this: HTMLIFrameElement) {
      return windows.get(this) ?? recordFor(this);
    },
  });
  const recordFor = (frame: HTMLIFrameElement) => {
    const recorded = {
      postMessage: (message: unknown, _origin?: unknown, transfer?: readonly unknown[]) => {
        inits.push(message as FrameInit);
        perFrame.set(frame, (message as FrameInit).dashboardContext);
        const port = transfer?.[0] as MessagePort | undefined;
        if (port) {
          port.onmessage = ({ data }: MessageEvent<Partial<FrameInit>>) => {
            if (!data.dashboardContext) return;
            perFrame.set(frame, data.dashboardContext);
          };
        }
      },
    } as Pick<Window, "postMessage">;
    windows.set(frame, recorded);
    return recorded;
  };
  return {
    /** Tells every widget frame on the page it loaded, and answers what each was sent. */
    loadAll: (frames: readonly HTMLElement[]) => {
      for (const frame of frames) fireEvent.load(frame);
      return inits;
    },
    /** The context each widget frame was last handed, one per frame. */
    latestContexts: () => [...perFrame.values()],
    restore: () => {
      if (real) Object.defineProperty(prototype, "contentWindow", real);
    },
  };
}
