/**
 * What the application does when it cannot find out who is here.
 * @vitest-environment jsdom
 * Spec: specs/auth/session-failure.feature
 */

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

import type { UiAuthClient } from "@langwatch/auth-contract";
import type { UiActiveScopeReading } from "@langwatch/browser-host/session";

import { useBrowserUiSession, useUiSessionReading } from "../ui-session";
import { UI_SESSION_QUERY_KEY } from "../ui-session-client";
import { answeringTransport } from "./answering-transport.test-helpers";

const JANE = "user_jane";

/** Ending the session is on the same client; no test here ends one. */
const refusesToSignOut = (): Promise<unknown> => {
  throw new Error("A session read ended the session.");
};

/** A proxy's own refusal: something answered, but not who is here. */
const proxyRefusal: UiAuthClient = {
  $fetch: () => Promise.resolve({ error: { status: 400, statusText: "Bad Request" } }),
  signOut: refusesToSignOut,
};

const unreachable: UiAuthClient = {
  $fetch: () => Promise.resolve({ error: { status: 503 } }),
  signOut: refusesToSignOut,
};

/** Fails the first read, then answers as `then` does. */
function failingOnceThen(then: UiAuthClient): UiAuthClient {
  let reads = 0;
  return {
    $fetch: (path: string) => {
      reads += 1;
      return reads === 1 ? proxyRefusal.$fetch(path) : then.$fetch(path);
    },
    signOut: refusesToSignOut,
  };
}

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

/** The scope host service beside this one, already settled on nothing. */
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
function SessionProbe({ authClient }: { authClient: UiAuthClient }) {
  const { pathname } = useLocation();
  const reading = useUiSessionReading({
    isPublicRoute: pathname.startsWith("/auth/"),
    authClient,
  });
  const session = useBrowserUiSession({
    transport: instantTransport,
    session: reading,
    scope: RESOLVED_SCOPE,
    isPublicRoute: false,
  });
  return (
    <div>
      <span data-testid="status">{reading.status}</span>
      <span data-testid="user">{session.currentUser()?.id ?? "nobody"}</span>
      <span data-testid="settled">{String(session.isSettled())}</span>
    </div>
  );
}

function renderSession({ path, authClient }: { path: string; authClient: UiAuthClient }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({
      path: routePath,
      element: (
        <QueryClientProvider client={queryClient}>
          <SessionProbe authClient={authClient} />
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
  /** What the shell's reconnecting screen does once the API answers again. */
  const readAgain = () => queryClient.invalidateQueries({ queryKey: UI_SESSION_QUERY_KEY });
  return { view, readAgain };
}

describe("given a session endpoint that fails the read without answering", () => {
  describe("when a screen asks who is here", () => {
    /** @scenario "A failed session read is not read as signed out" */
    it("holds the reader on the reconnecting state and sends them nowhere", async () => {
      const { view } = renderSession({ path: "/acme-app/traces", authClient: proxyRefusal });

      await waitFor(() => expect(view.getByTestId("status").textContent).toBe("offline"));
      expect(view.getByTestId("user").textContent).toBe("nobody");
      expect(departures.to).toEqual([]);
    });
  });

  describe("when the session is read again and answers with a signed-in reader", () => {
    /** @scenario "A reader whose session read recovers carries on unaffected" */
    it("signs them in where they were and sends them nowhere", async () => {
      const { view, readAgain } = renderSession({
        path: "/acme-app/traces",
        authClient: failingOnceThen(signedInAsJane),
      });
      await waitFor(() => expect(view.getByTestId("status").textContent).toBe("offline"));

      await readAgain();

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      expect(departures.to).toEqual([]);
    });
  });

  describe("when the session is read again and answers that nobody is signed in", () => {
    /** @scenario "A reader whose session read recovers to nobody goes to sign in" */
    it("sends them to sign in, carrying the address they asked for", async () => {
      const { view, readAgain } = renderSession({
        path: "/acme-app/traces",
        authClient: failingOnceThen(signedOut),
      });
      await waitFor(() => expect(view.getByTestId("status").textContent).toBe("offline"));
      expect(departures.to).toEqual([]);

      await readAgain();

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(departures.to[0]).toBe(
        `/auth/signin?callbackUrl=${encodeURIComponent("/acme-app/traces")}`,
      );
    });
  });
});

describe("given a browser that is offline", () => {
  describe("when the session answers that nobody is signed in", () => {
    /** @scenario "An offline visitor is not sent to sign in" */
    it("leaves the visitor where they are, since sign-in cannot load either", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      const { view } = renderSession({
        path: "/acme-app/traces",
        authClient: signedOut,
      });

      await waitFor(() => expect(view.getByTestId("status").textContent).toBe("anonymous"));
      expect(departures.to).toEqual([]);
    });
  });
});

describe("given the authentication service cannot be reached", () => {
  describe("when a screen on a route that needs a session reads it", () => {
    /** @scenario "Session connectivity failures are not anonymous sessions" */
    it("reads offline rather than anonymous, and sends the visitor nowhere", async () => {
      const { view } = renderSession({
        path: "/acme-app/traces",
        authClient: unreachable,
      });

      await waitFor(() => expect(view.getByTestId("status").textContent).toBe("offline"));
      expect(view.getByTestId("user").textContent).toBe("nobody");
      expect(departures.to).toEqual([]);
    });
  });
});

describe("given a session endpoint that answers that nobody is signed in", () => {
  describe("when the visitor is on a route that needs a session", () => {
    /** @scenario "A session answering that nobody is signed in reports nothing" */
    it("reports no failure, because nothing failed", async () => {
      const { view } = renderSession({
        path: "/acme-app/traces",
        authClient: signedOut,
      });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(view.getByTestId("user").textContent).toBe("nobody");
    });

    /** @scenario "A signed-out visitor on an authenticated route goes to sign in" */
    it("sends them to sign in, carrying the address they asked for", async () => {
      renderSession({
        path: "/acme-app/traces",
        authClient: signedOut,
      });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(departures.to[0]).toBe(
        `/auth/signin?callbackUrl=${encodeURIComponent("/acme-app/traces")}`,
      );
    });

    /** @scenario "A signed-out visitor is not sent to onboarding" */
    it("sends the visitor on the root to sign in, never to onboarding", async () => {
      renderSession({ path: "/", authClient: signedOut });

      await waitFor(() => expect(departures.to).toHaveLength(1));
      expect(departures.to[0]).toContain("/auth/signin");
      expect(departures.to.join(" ")).not.toContain("onboarding");
    });
  });

  describe("when the visitor is already on a public route", () => {
    /** @scenario "A signed-out visitor on a public route stays where they are" */
    it("leaves them on the sign-in screen rather than sending them to it again", async () => {
      const { view } = renderSession({
        path: "/auth/signin",
        authClient: signedOut,
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
      const { view } = renderSession({
        path: "/acme-app/traces",
        authClient: signedInAsJane,
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      expect(departures.to).toEqual([]);
    });
  });
});
