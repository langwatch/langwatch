/**
 * What the application does while the API is still coming up.
 * @vitest-environment jsdom
 * Spec: specs/ui/api-boot-wait.feature
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const departures = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("../src/behavior/ui-departure", () => ({
  uiLeaveTo: (url: string) => departures.to.push(url),
  uiOpenExternal: () => {
    throw new Error("The waiting screen opened a tab.");
  },
}));

import {
  UiFeedback,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "@langwatch/ui-host/capabilities";
import { useUiApiWait, UI_API_WAIT_HINT_AFTER_MS } from "../src/behavior/ui-api-reachability";
import type { UiFeatureApiTransport } from "../src/behavior/ui-feature-transport";
import { useBrowserUiSession } from "../src/behavior/ui-session";
import type { UiAuthClient } from "../src/behavior/ui-session-client";
import { UI_ORGANIZATIONS_PROCEDURE } from "../src/behavior/ui-session-queries";
import { UiApiWaitingScreen, UI_API_DEV_COMMAND } from "../src/ui/sections/ui-api-waiting-screen";
import { createUiFeatureShell } from "../src/ui/sections/ui-feature-shell";
import { JANE, organizationWith, PERSONAL_TEAM, SHARED_TEAM } from "./fixtures/ui-scope-graph";

const refusesToSignOut = (): Promise<unknown> => {
  throw new Error("A session read ended the session.");
};

/** Nothing is listening: the browser's own fetch never completed. */
const nothingListening: UiAuthClient = {
  $fetch: () => Promise.reject(new TypeError("Failed to fetch")),
  signOut: refusesToSignOut,
};

/** The reader is not signed in, and something said so. */
const notAuthenticated: UiAuthClient = {
  $fetch: () =>
    Promise.resolve({
      error: { status: 401, statusText: "Unauthorized", code: "unauthenticated" },
    }),
  signOut: refusesToSignOut,
};

/** Refuses until told the API is up, then answers with a signed-in reader. */
function bootingApi(): { client: UiAuthClient; comeUp: () => void } {
  let up = false;
  return {
    comeUp: () => {
      up = true;
    },
    client: {
      $fetch: () =>
        up
          ? Promise.resolve({
              data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
            })
          : Promise.reject(new TypeError("Failed to fetch")),
      signOut: refusesToSignOut,
    },
  };
}

class RecordingFeedback extends UiFeedback {
  readonly failures: UiFailureNotice[] = [];

  succeeded(_notice: UiSuccessNotice): void {
    throw new Error("The waiting screen reported a success.");
  }

  failed(failure: UiFailureNotice): void {
    this.failures.push(failure);
  }
}

const answeringTransport = {
  query: (path: string) =>
    path === UI_ORGANIZATIONS_PROCEDURE
      ? Promise.resolve(organizationWith({ teams: [PERSONAL_TEAM, SHARED_TEAM] }))
      : Promise.resolve({ permissions: [], enabled: false }),
} as unknown as UiFeatureApiTransport;

const ROUTE_PATHS = ["/", "/auth/signin", "/:project/traces"];

let dispose: (() => void) | undefined;

beforeEach(() => {
  departures.to.length = 0;
});

afterEach(() => {
  dispose?.();
  dispose = void 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderShell({
  path,
  authClient,
  feedback,
  page,
}: {
  path: string;
  authClient: UiAuthClient;
  feedback: UiFeedback;
  page: ReactNode;
}) {
  const Shell = createUiFeatureShell({
    apis: [],
    capabilities: { feedback },
    transport: answeringTransport,
    session: ({ transport: mounted, feedback: told }) =>
      useBrowserUiSession({ transport: mounted, feedback: told, authClient }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({
      path: routePath,
      element: (
        <QueryClientProvider client={queryClient}>
          <Shell>{page}</Shell>
        </QueryClientProvider>
      ),
    })),
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return view;
}

const PAGE = <span data-testid="page">the screen they asked for</span>;

describe("given nothing is listening on the API's address", () => {
  describe("when the application resolves who is here", () => {
    /** @scenario "The API is not listening yet" */
    it("holds the reader on the waiting screen, sends them nowhere, and tells them nothing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
      );
      const feedback = new RecordingFeedback();

      const view = renderShell({
        path: "/acme-app/traces",
        authClient: nothingListening,
        feedback,
        page: PAGE,
      });

      await waitFor(() => expect(view.getByTestId("api-waiting")).toBeTruthy());
      expect(view.getByTestId("api-waiting-endpoint").textContent).toContain("/api/health");
      expect(view.queryByTestId("page")).toBeNull();
      expect(departures.to).toEqual([]);
      expect(feedback.failures).toEqual([]);
    });
  });

  describe("when the API's health endpoint answers", () => {
    /** @scenario "The API answers and the reader continues" */
    it("reads the session again and renders the screen they asked for, with no failure", async () => {
      const api = bootingApi();
      let healthy = false;
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          healthy
            ? Promise.resolve(new Response(null, { status: 204 }))
            : Promise.reject(new TypeError("Failed to fetch")),
        ),
      );
      const feedback = new RecordingFeedback();

      const view = renderShell({
        path: "/acme-app/traces",
        authClient: api.client,
        feedback,
        page: PAGE,
      });

      await waitFor(() => expect(view.getByTestId("api-waiting")).toBeTruthy());

      healthy = true;
      api.comeUp();
      await waitFor(() => expect(view.getByTestId("page")).toBeTruthy(), { timeout: 5_000 });
      expect(view.queryByTestId("api-waiting")).toBeNull();
      expect(feedback.failures).toEqual([]);
    });
  });
});

describe("given the session endpoint says the reader is not authenticated", () => {
  describe("when the application resolves who is here", () => {
    /** @scenario "A genuine refusal still goes to sign in" */
    it("sends them to sign in and never shows the waiting screen", async () => {
      const feedback = new RecordingFeedback();

      const view = renderShell({
        path: "/acme-app/traces",
        authClient: notAuthenticated,
        feedback,
        page: PAGE,
      });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(departures.to[0]).toContain("/auth/signin");
      expect(view.queryByTestId("api-waiting")).toBeNull();
    });
  });
});

describe("given the wait has run long enough to be worth explaining", () => {
  describe("when the application is a developer's own stack", () => {
    /** @scenario "A long wait in development names the command that starts the API" */
    it("names the command that starts the API", () => {
      const view = render(
        <UiApiWaitingScreen endpoint="http://localhost:5560/api/health" isDevelopment explaining />,
      );
      dispose = () => view.unmount();

      expect(view.getByRole("heading").textContent).toBe("Starting the API");
      expect(view.getByTestId("api-waiting-hint").textContent).toContain(UI_API_DEV_COMMAND);
    });

    /** @scenario "A long wait in development names the command that starts the API" */
    it("waits a full minute before it starts explaining", async () => {
      vi.useFakeTimers();
      try {
        const probe = vi.fn(() => Promise.resolve(false));
        const { result } = renderHook(() => useUiApiWait({ waiting: true, probe }));

        expect(result.current.explaining).toBe(false);
        await act(async () => {
          vi.advanceTimersByTime(UI_API_WAIT_HINT_AFTER_MS);
        });
        expect(result.current.explaining).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the application is not a developer's own stack", () => {
    /** @scenario "A long wait in production names no command" */
    it("says it is reconnecting, names no command, and keeps the wait on screen", () => {
      const view = render(
        <UiApiWaitingScreen
          endpoint="https://app.langwatch.ai/api/health"
          isDevelopment={false}
          explaining
        />,
      );
      dispose = () => view.unmount();

      expect(view.getByRole("heading").textContent).toBe("Reconnecting");
      expect(view.queryByTestId("api-waiting-hint")).toBeNull();
      expect(view.getByTestId("api-waiting-endpoint").textContent).toContain("/api/health");
      expect(view.container.querySelector(".lw-api-waiting-pulse")).toBeTruthy();
    });
  });
});
