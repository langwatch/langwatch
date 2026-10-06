/**
 * Who is signed in resolves on its own query; what they may do waits for the
 * grant read, and a reading that has not answered grants nothing.
 * @vitest-environment jsdom
 */

import { UiFeedback } from "@langwatch/browser-host/capabilities";
import type { UiActiveScopeReading } from "@langwatch/browser-host/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { UiAuthClient } from "../../session";
import { useBrowserUiSession, useUiSessionReading } from "../ui-session";
import { UI_EFFECTIVE_PERMISSIONS_PROCEDURE } from "../ui-session-queries";
import type { UiFeatureApiTransport } from "../ui-session-queries";
import { answeringTransport } from "./answering-transport.test-helpers";

const JANE = "user-jane";

const signedInAsJane: UiAuthClient = {
  $fetch: () =>
    Promise.resolve({
      data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
    }),
  signOut: () => {
    throw new Error("A session read ended the session.");
  },
};

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

const ON_ACME_APP: UiActiveScopeReading = {
  status: "ready",
  organization: { id: "org-acme" },
  team: { id: "team-shared" },
  project: { id: "proj-app", slug: "acme-app", name: "ACME App" },
};

const RESOLVING: UiActiveScopeReading = {
  status: "loading",
  organization: void 0,
  team: void 0,
  project: void 0,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => void 0;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function SessionProbe({ transport }: { transport: UiFeatureApiTransport }) {
  const reading = useUiSessionReading({
    feedback: new SilentFeedback(),
    isPublicRoute: true,
    authClient: signedInAsJane,
  });
  const session = useBrowserUiSession({
    transport,
    session: reading,
    scope: reading.status === "loading" ? RESOLVING : ON_ACME_APP,
    isPublicRoute: false,
  });
  const { session: shared, permissions } = session.snapshot();
  return (
    <div>
      <span data-testid="session-status">{shared.status}</span>
      <span data-testid="user">{shared.user?.id ?? "nobody"}</span>
      <span data-testid="permissions-status">{permissions.status}</span>
      <span data-testid="can-project">{String(permissions.can("annotations:update"))}</span>
      <span data-testid="can-org">
        {String(permissions.canInOrganization("annotations:update"))}
      </span>
    </div>
  );
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function renderSession({ transport }: { transport: UiFeatureApiTransport }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/:project/traces",
        element: (
          <QueryClientProvider client={client}>
            <SessionProbe transport={transport} />
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: ["/acme-app/traces"] },
  );
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return view;
}

describe("given the authentication query has identified the signed-in user", () => {
  describe("when the selected project's grants have not answered", () => {
    /** @scenario "Authentication resolves independently of project grants" */
    it("is authenticated with that user while permissions load and grant nothing", async () => {
      const grants = deferred<unknown>();
      const view = renderSession({
        transport: answeringTransport((path) =>
          path === UI_EFFECTIVE_PERMISSIONS_PROCEDURE
            ? grants.promise
            : Promise.reject(new Error(`No test answer for ${path}`)),
        ),
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      expect(view.getByTestId("session-status").textContent).toBe("authenticated");
      expect(view.getByTestId("permissions-status").textContent).toBe("loading");
      expect(view.getByTestId("can-project").textContent).toBe("false");
      expect(view.getByTestId("can-org").textContent).toBe("false");

      grants.resolve({ permissions: ["annotations:update"] });
      await waitFor(() => expect(view.getByTestId("can-project").textContent).toBe("true"));
      expect(view.getByTestId("permissions-status").textContent).toBe("ready");
    });
  });
});
