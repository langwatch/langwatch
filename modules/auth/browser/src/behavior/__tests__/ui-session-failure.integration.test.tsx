/**
 * What the application does when it cannot find out who is here.
 * @vitest-environment jsdom
 * Spec: specs/auth/session-failure.feature
 */

import {
  UNKNOWN_ERROR_PRESENTATION,
  explainAnyError,
} from "@langwatch/error-presentation/presentation";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const departures = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@langwatch/browser-host/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uiLeaveTo: (url: string) => departures.to.push(url),
  uiOpenExternal: () => {
    throw new Error("The session read opened a tab.");
  },
}));

import {
  UiFeedback,
  type UiFailureNotice,
  type UiSuccessNotice,
} from "@langwatch/browser-host/capabilities";
import type { UiActiveScopeReading } from "@langwatch/browser-host/session";

import type { UiAuthClient } from "../../session";
import { useBrowserUiSession, useUiSessionReading } from "../ui-session";
import { answeringTransport } from "./answering-transport.test-helpers";

const JANE = "user_jane";

/** Ending the session is on the same client; no test here ends one. */
const refusesToSignOut = (): Promise<unknown> => {
  throw new Error("A session read ended the session.");
};

const refusedRead: UiAuthClient = {
  $fetch: () => Promise.resolve({ error: { status: 404, statusText: "Not Found" } }),
  signOut: refusesToSignOut,
};

const signedOut: UiAuthClient = {
  $fetch: () => Promise.resolve({ data: null }),
  signOut: refusesToSignOut,
};

const signedInAsJane: UiAuthClient = {
  $fetch: () =>
    Promise.resolve({
      data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
    }),
  signOut: refusesToSignOut,
};

class RecordingFeedback extends UiFeedback {
  readonly failures: UiFailureNotice[] = [];

  succeeded(_notice: UiSuccessNotice): void {
    throw new Error("The session read reported a success.");
  }

  failed(failure: UiFailureNotice): void {
    this.failures.push(failure);
  }
}

/** The scope capability beside this one, already settled on nothing. */
const RESOLVED_SCOPE: UiActiveScopeReading = {
  status: "ready",
  organization: void 0,
  team: void 0,
  project: void 0,
};

/** Grants and flags answer at once, so nothing here waits on them. */
const instantTransport = answeringTransport(() =>
  Promise.resolve({ permissions: [], enabled: false }),
);

const ROUTE_PATHS = ["/", "/auth/signin", "/:project/traces"];

let dispose: (() => void) | undefined;

beforeEach(() => {
  departures.to.length = 0;
});

afterEach(() => {
  dispose?.();
  dispose = void 0;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** The composition's session half, the two calls the root makes in order. */
function SessionProbe({
  authClient,
  feedback,
}: {
  authClient: UiAuthClient;
  feedback: UiFeedback;
}) {
  const { pathname } = useLocation();
  const reading = useUiSessionReading({
    feedback,
    isPublicRoute: pathname.startsWith("/auth/"),
    authClient,
  });
  const session = useBrowserUiSession({
    transport: instantTransport,
    session: reading,
    scope: RESOLVED_SCOPE,
  });
  return (
    <div>
      <span data-testid="user">{session.currentUser()?.id ?? "nobody"}</span>
      <span data-testid="settled">{String(session.isSettled())}</span>
    </div>
  );
}

function renderSession({
  path,
  authClient,
  feedback,
}: {
  path: string;
  authClient: UiAuthClient;
  feedback: UiFeedback;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({
      path: routePath,
      element: (
        <QueryClientProvider client={queryClient}>
          <SessionProbe authClient={authClient} feedback={feedback} />
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

describe("given a session endpoint that refuses the read", () => {
  describe("when a screen asks who is here", () => {
    /** @scenario "A refused session read reads as signed out" */
    it("answers nobody, and settles rather than holding the screen on nothing", async () => {
      const feedback = new RecordingFeedback();

      const view = renderSession({
        path: "/acme-app/traces",
        authClient: refusedRead,
        feedback,
      });

      await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
      expect(view.getByTestId("user").textContent).toBe("nobody");
    });

    /** @scenario "A refused session read is reported through the handled-error path" */
    it("tells the reader once, in the words registered for the code", async () => {
      const feedback = new RecordingFeedback();

      renderSession({
        path: "/acme-app/traces",
        authClient: refusedRead,
        feedback,
      });

      await waitFor(() => expect(feedback.failures).toHaveLength(1));
      const notice = feedback.failures[0]!;
      expect(readHandledError(notice.error)?.code).toBe("session_read_failed");
      const copy = explainAnyError(notice.error);
      expect(copy.title).not.toBe(UNKNOWN_ERROR_PRESENTATION.title);
      expect(copy.title).not.toBe(notice.fallbackTitle);
      expect(copy.description).not.toBe(UNKNOWN_ERROR_PRESENTATION.description);
    });

    /** @scenario "A signed-out visitor is not sent to onboarding" */
    it("sends the visitor on the root to sign in, never to onboarding", async () => {
      const feedback = new RecordingFeedback();

      renderSession({ path: "/", authClient: refusedRead, feedback });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(departures.to[0]).toContain("/auth/signin");
      expect(departures.to.join(" ")).not.toContain("onboarding");
    });
  });

  describe("when the browser is offline", () => {
    /** @scenario "An offline visitor is not sent to sign in" */
    it("leaves the visitor where they are, since sign-in cannot load either", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const feedback = new RecordingFeedback();

      const view = renderSession({
        path: "/acme-app/traces",
        authClient: refusedRead,
        feedback,
      });

      await waitFor(() => expect(feedback.failures).toHaveLength(1));
      expect(view.getByTestId("user").textContent).toBe("nobody");
      expect(departures.to).toEqual([]);
    });
  });
});

describe("given a session endpoint that answers that nobody is signed in", () => {
  describe("when the visitor is on a route that needs a session", () => {
    /** @scenario "A session answering that nobody is signed in reports nothing" */
    it("reports no failure, because nothing failed", async () => {
      const feedback = new RecordingFeedback();

      const view = renderSession({
        path: "/acme-app/traces",
        authClient: signedOut,
        feedback,
      });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(view.getByTestId("user").textContent).toBe("nobody");
      expect(feedback.failures).toEqual([]);
    });

    /** @scenario "A signed-out visitor on an authenticated route goes to sign in" */
    it("sends them to sign in, carrying the address they asked for", async () => {
      const feedback = new RecordingFeedback();

      renderSession({
        path: "/acme-app/traces",
        authClient: signedOut,
        feedback,
      });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(departures.to[0]).toBe(
        `/auth/signin?callbackUrl=${encodeURIComponent("/acme-app/traces")}`,
      );
    });
  });

  describe("when the visitor is already on a public route", () => {
    /** @scenario "A signed-out visitor on a public route stays where they are" */
    it("leaves them on the sign-in screen rather than sending them to it again", async () => {
      const feedback = new RecordingFeedback();

      const view = renderSession({
        path: "/auth/signin",
        authClient: signedOut,
        feedback,
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe("nobody"));
      expect(departures.to).toEqual([]);
    });
  });
});

describe("given a session endpoint that answers with a signed-in reader", () => {
  describe("when the visitor is on a route that needs a session", () => {
    /** @scenario "A signed-in reader is left where they are" */
    it("sends them nowhere and reports nothing", async () => {
      const feedback = new RecordingFeedback();

      const view = renderSession({
        path: "/acme-app/traces",
        authClient: signedInAsJane,
        feedback,
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      expect(departures.to).toEqual([]);
      expect(feedback.failures).toEqual([]);
    });
  });
});
