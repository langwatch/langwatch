/**
 * The session capability as a screen reads it: who is here, what they may
 * do, what is switched on. Where they are STANDING is the scope capability
 * beside this one, and it arrives here as a reading (§10.1).
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
import {
  UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
  UI_FEATURE_FLAG_PROCEDURE,
  type UiFeatureApiTransport,
} from "../ui-session-queries";
import { answeringTransport } from "./answering-transport.test-helpers";

const JANE = "user-jane";

type Call = { path: string; input: unknown };

/** The two procedures a session is built from, answered from memory. */
function recordingTransport({
  permissions = [],
  enabledFlags = [],
}: { permissions?: readonly string[]; enabledFlags?: readonly string[] } = {}) {
  const calls: Call[] = [];
  const transport = answeringTransport((path, input) => {
    calls.push({ path, input });
    switch (path) {
      case UI_EFFECTIVE_PERMISSIONS_PROCEDURE:
        return Promise.resolve({ permissions });
      case UI_FEATURE_FLAG_PROCEDURE:
        return Promise.resolve({
          enabled: typeof input.flag === "string" && enabledFlags.includes(input.flag),
        });
      default:
        return Promise.reject(new Error(`No test answer for ${path}`));
    }
  });
  const callsTo = (path: string) => calls.filter((call) => call.path === path);
  return { transport, callsTo };
}

/**
 * Ending the session is on the same client the read rides, but no screen here
 * ends one — so it refuses rather than resolving quietly, which would let a
 * sign-out reach it unnoticed.
 */
const refusesToSignOut = (): Promise<unknown> => {
  throw new Error("A session read ended the session.");
};

const signedInAsJane: UiAuthClient = {
  $fetch: () =>
    Promise.resolve({
      data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
    }),
  signOut: refusesToSignOut,
};

const signedOut: UiAuthClient = {
  $fetch: () => Promise.resolve({ data: null }),
  signOut: refusesToSignOut,
};

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

/** What the scope capability publishes while it is still resolving. */
const RESOLVING: UiActiveScopeReading = {
  status: "loading",
  organization: void 0,
  team: void 0,
  project: void 0,
};

/** What it publishes once the address bar's project has resolved. */
const ON_ACME_APP: UiActiveScopeReading = {
  status: "ready",
  organization: { id: "org-acme", name: "ACME" },
  team: { id: "team-shared", name: "ACME" },
  project: { id: "proj-app", slug: "acme-app", name: "ACME App" },
};

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
  window.localStorage.clear();
});

/**
 * The composition's two session calls, in order. The scope beside them is
 * still resolving until the session read answers — the real ordering, since
 * the scope is resolved against the reader's own organization graph.
 */
function SessionProbe({
  transport,
  authClient,
  scope = ON_ACME_APP,
  asks = [],
  flag,
}: {
  transport: UiFeatureApiTransport;
  authClient: UiAuthClient;
  scope?: UiActiveScopeReading;
  asks?: readonly string[];
  flag?: string;
}) {
  const reading = useUiSessionReading({
    feedback: new SilentFeedback(),
    isPublicRoute: true,
    authClient,
  });
  const session = useBrowserUiSession({
    transport,
    session: reading,
    scope: reading.status === "loading" ? RESOLVING : scope,
  });
  return (
    <div>
      <span data-testid="session-status">{reading.status}</span>
      <span data-testid="user">{session.currentUser()?.id ?? "nobody"}</span>
      <span data-testid="settled">{String(session.isSettled())}</span>
      <span data-testid="answers">
        {asks.map((permission) => `${permission}=${session.hasPermission(permission)}`).join(" ")}
      </span>
      <span data-testid="flag">{flag ? String(session.isFeatureEnabled(flag)) : ""}</span>
    </div>
  );
}

function renderSession(props: Parameters<typeof SessionProbe>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: "/:project/traces",
        element: (
          <QueryClientProvider client={queryClient}>
            <SessionProbe {...props} />
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

describe("given a screen mounted in a composition that reads the deployment's session", () => {
  it("publishes loading, and refuses every permission, before the query answers", () => {
    const { transport } = recordingTransport({ permissions: ["datasets:manage"] });

    const view = renderSession({
      transport,
      authClient: signedInAsJane,
      asks: ["datasets:view"],
    });

    expect(view.getByTestId("session-status").textContent).toBe("loading");
    expect(view.getByTestId("user").textContent).toBe("nobody");
    expect(view.getByTestId("answers").textContent).toBe("datasets:view=false");
    expect(view.getByTestId("settled").textContent).toBe("false");
  });

  it("answers with the signed-in reader once the read lands", async () => {
    const { transport } = recordingTransport();

    const view = renderSession({ transport, authClient: signedInAsJane });

    await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
    expect(view.getByTestId("session-status").textContent).toBe("authenticated");
  });

  it("publishes anonymous from the auth query without waiting for grants", async () => {
    const { transport } = recordingTransport();

    const view = renderSession({ transport, authClient: signedOut });

    await waitFor(() => expect(view.getByTestId("session-status").textContent).toBe("anonymous"));
    expect(view.getByTestId("user").textContent).toBe("nobody");
  });

  it("keeps an auth refusal distinct from an offline session read", async () => {
    const { transport } = recordingTransport();
    const refused: UiAuthClient = {
      $fetch: () => Promise.resolve({ error: { code: "session_refused", status: 401 } }),
      signOut: refusesToSignOut,
    };

    const refusedView = renderSession({ transport, authClient: refused });
    await waitFor(() =>
      expect(refusedView.getByTestId("session-status").textContent).toBe("error"),
    );
    dispose?.();

    const offline: UiAuthClient = {
      $fetch: () => Promise.resolve({ error: { status: 503 } }),
      signOut: refusesToSignOut,
    };
    const offlineView = renderSession({ transport, authClient: offline });
    await waitFor(() =>
      expect(offlineView.getByTestId("session-status").textContent).toBe("offline"),
    );
  });
});

describe("given a screen that asks what the reader may do", () => {
  describe("when the server has answered for the scope", () => {
    it("satisfies a narrower permission from a broader grant", async () => {
      const { transport } = recordingTransport({ permissions: ["datasets:manage"] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        asks: ["datasets:view", "datasets:manage", "prompts:view"],
      });

      await waitFor(() =>
        expect(view.getByTestId("answers").textContent).toBe(
          "datasets:view=true datasets:manage=true prompts:view=false",
        ),
      );
    });
  });

  describe("when the scope has not resolved yet", () => {
    it("refuses everything, so nothing renders open and then closes", async () => {
      const { transport } = recordingTransport({ permissions: ["datasets:manage"] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        scope: RESOLVING,
        asks: ["datasets:view"],
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      expect(view.getByTestId("answers").textContent).toBe("datasets:view=false");
      expect(view.getByTestId("settled").textContent).toBe("false");
    });
  });

  describe("when a screen asks about many permissions on every render", () => {
    it("asks the server once for the scope, not once per question", async () => {
      const { transport, callsTo } = recordingTransport({ permissions: ["datasets:manage"] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        asks: [
          "datasets:view",
          "datasets:manage",
          "prompts:view",
          "prompts:manage",
          "analytics:view",
          "workflows:view",
        ],
      });

      await waitFor(() =>
        expect(view.getByTestId("answers").textContent).toContain("datasets:view=true"),
      );
      expect(callsTo(UI_EFFECTIVE_PERMISSIONS_PROCEDURE)).toHaveLength(2);
    });

    it("asks separately about the resolved project and organization", async () => {
      const { transport, callsTo } = recordingTransport();

      const view = renderSession({ transport, authClient: signedInAsJane });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      await waitFor(() => expect(callsTo(UI_EFFECTIVE_PERMISSIONS_PROCEDURE)).toHaveLength(2));
      expect(callsTo(UI_EFFECTIVE_PERMISSIONS_PROCEDURE).map((call) => call.input)).toEqual([
        { projectId: "proj-app" },
        { organizationId: "org-acme" },
      ]);
    });
  });
});

describe("given a screen that asks whether a feature is switched on", () => {
  describe("when it asks for the first time", () => {
    it("answers no, and has the answer on the render after", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: ["release_new_thing"] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        flag: "release_new_thing",
      });

      expect(view.getByTestId("flag").textContent).toBe("false");
      await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
      expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)).toHaveLength(1);
    });

    it("states both scopes on the read, so a rule that names one can match", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: ["release_new_thing"] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        flag: "release_new_thing",
      });

      await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
      expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)[0]?.input).toEqual({
        flag: "release_new_thing",
        projectId: "proj-app",
        organizationId: "org-acme",
      });
    });
  });

  describe("when the scope has not resolved yet", () => {
    it("asks nothing, since a read that leaves out a scope can never match", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: ["release_new_thing"] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        scope: RESOLVING,
        flag: "release_new_thing",
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
      expect(view.getByTestId("flag").textContent).toBe("false");
      expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)).toHaveLength(0);
    });
  });

  describe("when the flag is off for this scope", () => {
    it("keeps answering no", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: [] });

      const view = renderSession({
        transport,
        authClient: signedInAsJane,
        flag: "release_new_thing",
      });

      await waitFor(() => expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)).toHaveLength(1));
      expect(view.getByTestId("flag").textContent).toBe("false");
    });
  });
});
