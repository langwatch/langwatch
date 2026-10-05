/**
 * A public page (the shared trace) holds no permission, signed in or not, as on main. The
 * composition tells the session which addresses are public; each route here says so the same way.
 * Spec: specs/frontend/session-permission-reads.feature (plan batch 2).
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const departures = vi.hoisted(() => ({ to: [] as string[] }));

vi.mock("@langwatch/browser-host/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uiLeaveTo: (url: string) => departures.to.push(url),
}));

import { UiFeedback } from "@langwatch/browser-host/capabilities";
import type { UiActiveScopeReading } from "@langwatch/browser-host/session";

import type { UiAuthClient } from "../../session";
import { useBrowserUiSession, useUiSessionReading } from "../ui-session";
import {
  UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
  type UiFeatureApiTransport,
} from "../ui-session-queries";
import { answeringTransport } from "./answering-transport.test-helpers";

const ASKED = ["traces:update", "annotations:update", "datasets:manage"] as const;

const SHARED_PROJECT: UiActiveScopeReading = {
  status: "ready",
  organization: { id: "org-shared" },
  team: { id: "team-shared" },
  project: { id: "proj-shared", slug: "shared-app", name: "Shared App" },
};

const OWN_PROJECT: UiActiveScopeReading = {
  status: "ready",
  organization: { id: "org-own" },
  team: { id: "team-own" },
  project: { id: "proj-own", slug: "own-app", name: "Own App" },
};

const refusesToSignOut = (): Promise<unknown> => {
  throw new Error("A session read ended the session.");
};

const signedInAsJane: UiAuthClient = {
  $fetch: () =>
    Promise.resolve({
      data: { user: { id: "user-jane", name: "Jane", email: "jane@example.com", image: null } },
    }),
  signOut: refusesToSignOut,
};

const neverAnswers: UiAuthClient = {
  $fetch: () => new Promise(() => void 0),
  signOut: refusesToSignOut,
};

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

/** Grants every permission asked about, in any scope, and records each grant read. */
function grantingTransport() {
  const reads: Record<string, unknown>[] = [];
  const transport = answeringTransport((path, input) => {
    if (path !== UI_EFFECTIVE_PERMISSIONS_PROCEDURE) {
      return Promise.reject(new Error(`No test answer for ${path}`));
    }
    reads.push(input);
    return Promise.resolve({ permissions: [...ASKED, "organization:manage"] });
  });
  const readsFor = (projectId: string) => reads.filter((input) => input.projectId === projectId);
  return { transport, reads, readsFor };
}

function SessionProbe({
  transport,
  authClient,
  scope,
  isPublicRoute,
}: {
  transport: UiFeatureApiTransport;
  authClient: UiAuthClient;
  scope: UiActiveScopeReading;
  isPublicRoute: boolean;
}) {
  const reading = useUiSessionReading({
    feedback: new SilentFeedback(),
    isPublicRoute,
    authClient,
  });
  const session = useBrowserUiSession({ transport, session: reading, scope, isPublicRoute });
  return (
    <div>
      <span data-testid="session-status">{reading.status}</span>
      <span data-testid="settled">{String(session.isSettled())}</span>
      <span data-testid="answers">
        {ASKED.map((permission) => `${permission}=${session.hasPermission(permission)}`).join(" ")}
      </span>
      <span data-testid="organization">
        {String(session.hasOrganizationPermission("organization:manage"))}
      </span>
    </div>
  );
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  departures.to.length = 0;
});

afterEach(() => {
  dispose?.();
  dispose = void 0;
  window.localStorage.clear();
});

function renderAt({
  path,
  transport,
  authClient,
}: {
  path: string;
  transport: UiFeatureApiTransport;
  authClient: UiAuthClient;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const probe = (scope: UiActiveScopeReading, isPublicRoute: boolean) => (
    <QueryClientProvider client={queryClient}>
      <SessionProbe
        transport={transport}
        authClient={authClient}
        scope={scope}
        isPublicRoute={isPublicRoute}
      />
    </QueryClientProvider>
  );
  const router = createMemoryRouter(
    [
      { path: "/share/:id", element: probe(SHARED_PROJECT, true) },
      { path: "/shared-app/traces", element: probe(SHARED_PROJECT, false) },
      { path: "/own-app/traces", element: probe(OWN_PROJECT, false) },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return { ...view, navigate: (to: string) => router.navigate(to) };
}

const NOTHING_HELD = ASKED.map((permission) => `${permission}=false`).join(" ");

describe("given a signed-in reader who may update traces in the shared trace's project", () => {
  describe("when they open the shared trace link", () => {
    /** @scenario "A signed-in member on a shared trace holds no permission there either" */
    it("holds no permission there and sends no grant read for that project", async () => {
      const { transport, readsFor } = grantingTransport();
      const view = renderAt({
        path: "/share/token-1",
        transport,
        authClient: signedInAsJane,
      });

      await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
      expect(view.getByTestId("session-status").textContent).toBe("authenticated");
      expect(view.getByTestId("answers").textContent).toBe(NOTHING_HELD);
      expect(view.getByTestId("organization").textContent).toBe("false");
      expect(readsFor("proj-shared")).toEqual([]);
    });
  });

  describe("when they reach the shared trace after their own grants for its project were read", () => {
    it("does not answer from the grants already cached for that project", async () => {
      const { transport, readsFor } = grantingTransport();
      const view = renderAt({
        path: "/shared-app/traces",
        transport,
        authClient: signedInAsJane,
      });
      await waitFor(() =>
        expect(view.getByTestId("answers").textContent).toContain("traces:update=true"),
      );
      const readsBefore = readsFor("proj-shared").length;

      await view.navigate("/share/token-1");

      await waitFor(() => expect(view.getByTestId("answers").textContent).toBe(NOTHING_HELD));
      expect(view.getByTestId("organization").textContent).toBe("false");
      expect(readsFor("proj-shared")).toHaveLength(readsBefore);
    });
  });
});

describe("given the session read has not answered yet", () => {
  describe("when a visitor opens a valid shared trace link", () => {
    /** @scenario "A shared trace renders while the session read has not answered" */
    it("leaves the visitor on the page and holds no permission", async () => {
      const { transport, reads } = grantingTransport();
      const view = renderAt({ path: "/share/token-1", transport, authClient: neverAnswers });

      expect(view.getByTestId("session-status").textContent).toBe("loading");
      expect(view.getByTestId("answers").textContent).toBe(NOTHING_HELD);
      expect(view.getByTestId("organization").textContent).toBe("false");
      await new Promise((settle) => setTimeout(settle, 20));
      expect(departures.to).toEqual([]);
      expect(reads).toEqual([]);
    });
  });
});

describe("given a signed-in reader on a shared trace page", () => {
  describe("when they navigate to their own project's traces page", () => {
    /** @scenario "Leaving a shared trace for a project page reads the reader's own grants again" */
    it("sends the grant read for their own project and holds update traces there", async () => {
      const { transport, readsFor } = grantingTransport();
      const view = renderAt({
        path: "/share/token-1",
        transport,
        authClient: signedInAsJane,
      });
      await waitFor(() => expect(view.getByTestId("settled").textContent).toBe("true"));
      expect(readsFor("proj-own")).toEqual([]);

      await view.navigate("/own-app/traces");

      await waitFor(() => expect(readsFor("proj-own")).toHaveLength(1));
      await waitFor(() =>
        expect(view.getByTestId("answers").textContent).toContain("traces:update=true"),
      );
    });
  });
});
