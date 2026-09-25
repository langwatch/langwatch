/**
 * Where the reader is standing, resolved from the address bar, the graph and
 * the device's memory — the scope capability's half of the composition.
 * @vitest-environment jsdom
 */

import { createApiFixture } from "@langwatch/api-fixture";
import { UiSession } from "@langwatch/browser-host/capabilities";
import type { UiSessionReading, UiSessionSnapshot } from "@langwatch/browser-host/session";
import type { UiScopeTeam } from "@langwatch/organization-contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  createBrowserUiScope,
  useUiScopeReading,
  type UiScopeReading,
} from "../ui-scope-capability";
import {
  UI_ORGANIZATIONS_PROCEDURE,
  UI_SHARED_TRACE_PROCEDURE,
  type UiFeatureApiTransport,
} from "../ui-scope-queries";
import { UI_SELECTED_PROJECT_SLUG_KEY, UI_SELECTED_TEAM_ID_KEY } from "../ui-scope-storage";
import { JANE, organizationWith, PERSONAL_TEAM, SHARED_TEAM } from "./ui-scope-graph";

type Call = { path: string; input: unknown };

/** The two reads the scope resolves itself from, answered from memory. */
function recordingTransport({
  teams = [PERSONAL_TEAM, SHARED_TEAM],
}: { teams?: readonly UiScopeTeam[] } = {}) {
  const calls: Call[] = [];
  const transport = createApiFixture<UiFeatureApiTransport>({
    query: (path: string, input: unknown) => {
      calls.push({ path, input });
      switch (path) {
        case UI_ORGANIZATIONS_PROCEDURE:
          return Promise.resolve(organizationWith({ teams }));
        case UI_SHARED_TRACE_PROCEDURE:
          return Promise.resolve({
            project: { id: "proj-shared", name: "Shared", slug: "shared-project" },
          });
        default:
          return Promise.reject(new Error(`No test answer for ${path}`));
      }
    },
  });
  const callsTo = (path: string) => calls.filter((call) => call.path === path);
  return { transport, callsTo };
}

const SIGNED_IN: UiSessionReading = {
  status: "authenticated",
  user: { id: JANE, name: "Jane", email: null, image: null },
};

const SIGNED_OUT: UiSessionReading = { status: "anonymous", user: null };

/** Every address the scope rules distinguish, mounted on one page component. */
const ROUTE_PATHS = [
  "/",
  "/messages",
  "/settings/api-keys",
  "/me",
  "/me/sessions",
  "/share/:id",
  "/:project",
  "/:project/traces",
];

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
  window.localStorage.clear();
});

/** What the scope answers, read through the port the composition installs. */
function ScopeProbe({
  transport,
  session,
}: {
  transport: UiFeatureApiTransport;
  session: UiSessionReading;
}) {
  const reading: UiScopeReading = useUiScopeReading({ transport, session });
  const scope = createBrowserUiScope({ reading, session: new NoGrants(session, reading) });
  const active = scope.activeScope();
  return (
    <div>
      <span data-testid="status">{reading.scope.status}</span>
      <span data-testid="organization">{active.organizationId ?? "none"}</span>
      <span data-testid="project">{active.projectId ?? "none"}</span>
      <span data-testid="host">{scope.scopeHost() ? "published" : "none"}</span>
    </div>
  );
}

/**
 * The session port beside the scope, answering no grants — the scope port
 * takes the whole session, and these tests are about where, not what-may.
 */
class NoGrants extends UiSession {
  constructor(
    private readonly reading: UiSessionReading,
    private readonly resolved: UiScopeReading,
  ) {
    super();
  }

  currentUser() {
    return this.reading.user;
  }

  hasPermission(): boolean {
    return false;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean {
    return false;
  }

  override snapshot(): UiSessionSnapshot {
    return {
      session: this.reading,
      scope: this.resolved.scope,
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => false,
        canInOrganization: () => false,
      },
    };
  }
}

function renderScope({
  path,
  transport,
  session = SIGNED_IN,
}: {
  path: string;
  transport: UiFeatureApiTransport;
  session?: UiSessionReading;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({
      path: routePath,
      element: (
        <QueryClientProvider client={queryClient}>
          <ScopeProbe transport={transport} session={session} />
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

describe("given the address bar names a project", () => {
  it("resolves that project and the organization it belongs to", async () => {
    const { transport } = recordingTransport();

    const view = renderScope({ path: "/acme-app/traces", transport });

    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
    expect(view.getByTestId("organization").textContent).toBe("org-acme");
  });

  it("remembers it for the next page that names none", async () => {
    const { transport } = recordingTransport();

    renderScope({ path: "/acme-app/traces", transport });

    await waitFor(() =>
      expect(window.localStorage.getItem(UI_SELECTED_PROJECT_SLUG_KEY)).toBe('"acme-app"'),
    );
    expect(window.localStorage.getItem(UI_SELECTED_TEAM_ID_KEY)).toBe('"team-shared"');
  });
});

describe("given the address bar names a reserved top-level route", () => {
  it("does not look for a project of that name, and keeps the remembered one", async () => {
    // The remembered project is deliberately NOT the team's first: a team
    // with one project answers the same whether the reserved segment was
    // refused as an address or merely matched nothing.
    window.localStorage.setItem(UI_SELECTED_PROJECT_SLUG_KEY, JSON.stringify("acme-app"));
    const { transport } = recordingTransport({
      teams: [
        {
          ...SHARED_TEAM,
          projects: [
            { id: "proj-first", slug: "acme-first", name: "First" },
            ...SHARED_TEAM.projects,
          ],
        },
      ],
    });

    const view = renderScope({ path: "/messages", transport });

    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
  });
});

describe("given the page names no project and a personal workspace is remembered", () => {
  it("resolves the organization's project rather than the private one", async () => {
    window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, JSON.stringify("team-personal"));
    window.localStorage.setItem(
      UI_SELECTED_PROJECT_SLUG_KEY,
      JSON.stringify("personal-jane-abc123"),
    );
    const { transport } = recordingTransport();

    const view = renderScope({ path: "/settings/api-keys", transport });

    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
  });
});

describe("given the page is the personal workspace's own", () => {
  it("resolves the personal project, whatever an earlier page remembered", async () => {
    window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, JSON.stringify("team-shared"));
    window.localStorage.setItem(UI_SELECTED_PROJECT_SLUG_KEY, JSON.stringify("acme-app"));
    const { transport } = recordingTransport();

    const view = renderScope({ path: "/me/sessions", transport });

    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-personal"));
  });
});

describe("given a share token in the address bar", () => {
  it("resolves the project the token addresses and no organization", async () => {
    const { transport } = recordingTransport();

    const view = renderScope({ path: "/share/token-123", transport, session: SIGNED_OUT });

    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-shared"));
    expect(view.getByTestId("organization").textContent).toBe("none");
  });

  it("does not ask for the organization graph a share viewer has no claim on", async () => {
    const { transport, callsTo } = recordingTransport();

    const view = renderScope({ path: "/share/token-123", transport, session: SIGNED_OUT });

    await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-shared"));
    expect(callsTo(UI_ORGANIZATIONS_PROCEDURE)).toHaveLength(0);
  });
});

describe("given nothing has resolved yet", () => {
  it("reads as loading and publishes no legacy host, so nothing renders scoped", () => {
    const { transport } = recordingTransport();

    const view = renderScope({ path: "/acme-app/traces", transport });

    expect(view.getByTestId("status").textContent).toBe("loading");
    expect(view.getByTestId("project").textContent).toBe("none");
    expect(view.getByTestId("host").textContent).toBe("none");
  });
});
