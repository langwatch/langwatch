/**
 * The session capability as a screen meets it: mounted in the shell, reading a
 * real router, real storage and a real React Query cache, with only the two
 * things a browser cannot supply in a test stubbed — the transport the four
 * reads travel on, and the auth client that answers who is signed in.
 *
 * What is asserted is what a screen would see. `hasPermission` and
 * `isFeatureEnabled` are called the way a render calls them, and the requests
 * that reach the transport are counted: answering once per scope rather than
 * once per call is the property that keeps a page asking about a dozen
 * permissions from making a dozen round trips.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  UiCapabilityUnavailableError,
  UiSessionPort,
  useUiCapabilities,
} from "../src/behavior/ui-capabilities";
import type { UiFeatureApiTransport } from "../src/behavior/ui-feature-transport";
import { useBrowserUiSession } from "../src/behavior/ui-session";
import type { UiAuthClient } from "../src/behavior/ui-session-client";
import {
  UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
  UI_FEATURE_FLAG_PROCEDURE,
  UI_ORGANIZATIONS_PROCEDURE,
  UI_SHARED_TRACE_PROCEDURE,
} from "../src/behavior/ui-session-queries";
import {
  UI_SELECTED_PROJECT_SLUG_KEY,
  UI_SELECTED_TEAM_ID_KEY,
} from "../src/behavior/ui-scope-storage";
import type { UiScopeTeam } from "../src/model/ui-scope";
import { createUiFeatureShell } from "../src/ui/sections/ui-feature-shell";
import { JANE, organizationWith, PERSONAL_TEAM, SHARED_TEAM } from "./fixtures/ui-scope-graph";

type Call = { path: string; input: unknown };

/** The four procedures a session is built from, answered from memory. */
function recordingTransport({
  permissions = [],
  enabledFlags = [],
  teams = [PERSONAL_TEAM, SHARED_TEAM],
}: {
  permissions?: readonly string[];
  enabledFlags?: readonly string[];
  teams?: readonly UiScopeTeam[];
} = {}) {
  const calls: Call[] = [];
  const transport = {
    query: (path: string, input: unknown) => {
      calls.push({ path, input });
      switch (path) {
        case UI_ORGANIZATIONS_PROCEDURE:
          return Promise.resolve(organizationWith({ teams }));
        case UI_EFFECTIVE_PERMISSIONS_PROCEDURE:
          return Promise.resolve({ scope: { type: "project", id: "proj-app" }, permissions });
        case UI_FEATURE_FLAG_PROCEDURE:
          return Promise.resolve({
            enabled: enabledFlags.includes((input as { flag: string }).flag),
          });
        case UI_SHARED_TRACE_PROCEDURE:
          return Promise.resolve({
            project: { id: "proj-shared", name: "Shared", slug: "shared-project" },
          });
        default:
          return Promise.reject(new Error(`No test answer for ${path}`));
      }
    },
  };
  const callsTo = (path: string) => calls.filter((call) => call.path === path);
  return { transport: transport as unknown as UiFeatureApiTransport, calls, callsTo };
}

const signedInAsJane: UiAuthClient = {
  $fetch: () =>
    Promise.resolve({
      data: { user: { id: JANE, name: "Jane", email: "jane@example.com", image: null } },
    }),
};

const signedOut: UiAuthClient = { $fetch: () => Promise.resolve({ data: null }) };

class StubSession extends UiSessionPort {
  currentUser() {
    return { id: "installed-user", name: null, email: null, image: null };
  }

  activeScope() {
    return { organizationId: "installed-org", projectId: "installed-project" };
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return true;
  }
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
  window.localStorage.clear();
});

/** Every address the scope rules distinguish, mounted on one page component. */
const ROUTE_PATHS = [
  "/",
  "/settings/api-keys",
  "/me",
  "/me/sessions",
  "/share/:id",
  "/:project",
  "/:project/traces",
];

function renderSession({
  path,
  transport,
  authClient = signedInAsJane,
  page,
  installed,
  live = true,
}: {
  path: string;
  transport: UiFeatureApiTransport;
  authClient?: UiAuthClient;
  page: ReactNode;
  installed?: UiSessionPort;
  live?: boolean;
}) {
  const Shell = createUiFeatureShell({
    apis: [],
    capabilities: installed ? { session: installed } : {},
    transport,
    ...(live
      ? {
          session: ({ transport: mounted }) =>
            useBrowserUiSession({ transport: mounted, authClient }),
        }
      : {}),
  });
  const element = <Shell>{page}</Shell>;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({
      path: routePath,
      element: <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
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

/** A screen that renders what the session answers, and nothing else. */
function ScopeProbe() {
  const { session } = useUiCapabilities();
  const scope = session.activeScope();
  return (
    <div>
      <span data-testid="user">{session.currentUser()?.id ?? "nobody"}</span>
      <span data-testid="organization">{scope.organizationId ?? "none"}</span>
      <span data-testid="project">{scope.projectId ?? "none"}</span>
    </div>
  );
}

describe("given a screen mounted in a composition that reads the deployment's session", () => {
  describe("when the reader is signed in", () => {
    it("answers with the signed-in reader", async () => {
      const { transport } = recordingTransport();

      const view = renderSession({ path: "/acme-app/traces", transport, page: <ScopeProbe /> });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe(JANE));
    });

    it("answers with nobody while the read is still in flight", () => {
      const { transport } = recordingTransport();

      const view = renderSession({ path: "/acme-app/traces", transport, page: <ScopeProbe /> });

      expect(view.getByTestId("user").textContent).toBe("nobody");
    });

    it("answers with nobody when the deployment says nobody is", async () => {
      const { transport } = recordingTransport();

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        authClient: signedOut,
        page: <ScopeProbe />,
      });

      await waitFor(() => expect(view.getByTestId("project").textContent).not.toBe("none"));
      expect(view.getByTestId("user").textContent).toBe("nobody");
    });
  });

  describe("when the address bar names a project", () => {
    it("resolves that project and the organization it belongs to", async () => {
      const { transport } = recordingTransport();

      const view = renderSession({ path: "/acme-app/traces", transport, page: <ScopeProbe /> });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
      expect(view.getByTestId("organization").textContent).toBe("org-acme");
    });

    it("remembers it for the next page that names none", async () => {
      const { transport } = recordingTransport();

      renderSession({ path: "/acme-app/traces", transport, page: <ScopeProbe /> });

      await waitFor(() =>
        expect(window.localStorage.getItem(UI_SELECTED_PROJECT_SLUG_KEY)).toBe('"acme-app"'),
      );
      expect(window.localStorage.getItem(UI_SELECTED_TEAM_ID_KEY)).toBe('"team-shared"');
    });
  });

  describe("when the address bar names a reserved top-level route", () => {
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

      const view = renderSession({ path: "/messages", transport, page: <ScopeProbe /> });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
    });
  });

  describe("when the page names no project and a personal workspace is remembered", () => {
    it("resolves the organization's project rather than the private one", async () => {
      window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, JSON.stringify("team-personal"));
      window.localStorage.setItem(
        UI_SELECTED_PROJECT_SLUG_KEY,
        JSON.stringify("personal-jane-abc123"),
      );
      const { transport } = recordingTransport();

      const view = renderSession({ path: "/settings/api-keys", transport, page: <ScopeProbe /> });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
    });
  });

  describe("when the page is the personal workspace's own", () => {
    it("resolves the personal project, whatever an earlier page remembered", async () => {
      window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, JSON.stringify("team-shared"));
      window.localStorage.setItem(UI_SELECTED_PROJECT_SLUG_KEY, JSON.stringify("acme-app"));
      const { transport } = recordingTransport();

      const view = renderSession({ path: "/me/sessions", transport, page: <ScopeProbe /> });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-personal"));
    });
  });
});

/** A screen that asks about permissions the way a render asks about them. */
function PermissionProbe({ asks }: { asks: readonly string[] }) {
  const { session } = useUiCapabilities();
  return (
    <div data-testid="answers">
      {asks.map((permission) => `${permission}=${session.hasPermission(permission)}`).join(" ")}
    </div>
  );
}

describe("given a screen that asks what the reader may do", () => {
  describe("when the server has answered for the scope", () => {
    it("satisfies a narrower permission from a broader grant", async () => {
      const { transport } = recordingTransport({ permissions: ["datasets:manage"] });

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <PermissionProbe asks={["datasets:view", "datasets:manage", "prompts:view"]} />,
      });

      await waitFor(() =>
        expect(view.getByTestId("answers").textContent).toBe(
          "datasets:view=true datasets:manage=true prompts:view=false",
        ),
      );
    });
  });

  describe("when the answer has not arrived yet", () => {
    it("refuses everything, so nothing renders open and then closes", () => {
      const { transport } = recordingTransport({ permissions: ["datasets:manage"] });

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <PermissionProbe asks={["datasets:view"]} />,
      });

      expect(view.getByTestId("answers").textContent).toBe("datasets:view=false");
    });
  });

  describe("when a screen asks about many permissions on every render", () => {
    it("asks the server once for the scope, not once per question", async () => {
      const { transport, callsTo } = recordingTransport({ permissions: ["datasets:manage"] });
      const asks = [
        "datasets:view",
        "datasets:manage",
        "prompts:view",
        "prompts:manage",
        "analytics:view",
        "workflows:view",
      ];

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <PermissionProbe asks={asks} />,
      });

      await waitFor(() =>
        expect(view.getByTestId("answers").textContent).toContain("datasets:view=true"),
      );
      expect(callsTo(UI_EFFECTIVE_PERMISSIONS_PROCEDURE)).toHaveLength(1);
    });

    it("asks about the project it resolved, and not about the organization as well", async () => {
      const { transport, callsTo } = recordingTransport({ permissions: [] });

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <ScopeProbe />,
      });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-app"));
      await waitFor(() => expect(callsTo(UI_EFFECTIVE_PERMISSIONS_PROCEDURE)).toHaveLength(1));
      expect(callsTo(UI_EFFECTIVE_PERMISSIONS_PROCEDURE)[0]?.input).toEqual({
        projectId: "proj-app",
      });
    });
  });
});

/** A screen that asks whether a feature is switched on for it. */
function FlagProbe({ flag }: { flag: string }) {
  const { session } = useUiCapabilities();
  return <div data-testid="flag">{String(session.isFeatureEnabled(flag))}</div>;
}

describe("given a screen that asks whether a feature is switched on", () => {
  describe("when it asks for the first time", () => {
    it("answers no, and has the answer on the render after", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: ["release_new_thing"] });

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <FlagProbe flag="release_new_thing" />,
      });

      expect(view.getByTestId("flag").textContent).toBe("false");
      await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
      expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)).toHaveLength(1);
    });

    it("states both scopes on the read, so a rule that names one can match", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: ["release_new_thing"] });

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <FlagProbe flag="release_new_thing" />,
      });

      await waitFor(() => expect(view.getByTestId("flag").textContent).toBe("true"));
      expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)[0]?.input).toEqual({
        flag: "release_new_thing",
        projectId: "proj-app",
        organizationId: "org-acme",
      });
    });
  });

  describe("when the flag is off for this scope", () => {
    it("keeps answering no", async () => {
      const { transport, callsTo } = recordingTransport({ enabledFlags: [] });

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <FlagProbe flag="release_new_thing" />,
      });

      await waitFor(() => expect(callsTo(UI_FEATURE_FLAG_PROCEDURE)).toHaveLength(1));
      expect(view.getByTestId("flag").textContent).toBe("false");
    });
  });
});

describe("given a share token in the address bar", () => {
  describe("when a signed-out reader opens it", () => {
    it("resolves the project the token addresses and no organization", async () => {
      const { transport } = recordingTransport();

      const view = renderSession({
        path: "/share/token-123",
        transport,
        authClient: signedOut,
        page: <ScopeProbe />,
      });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-shared"));
      expect(view.getByTestId("organization").textContent).toBe("none");
      expect(view.getByTestId("user").textContent).toBe("nobody");
    });

    it("does not ask for the organization graph a share viewer has no claim on", async () => {
      const { transport, callsTo } = recordingTransport();

      const view = renderSession({
        path: "/share/token-123",
        transport,
        authClient: signedOut,
        page: <ScopeProbe />,
      });

      await waitFor(() => expect(view.getByTestId("project").textContent).toBe("proj-shared"));
      expect(callsTo(UI_ORGANIZATIONS_PROCEDURE)).toHaveLength(0);
    });
  });
});

describe("given a composition that installs no session", () => {
  describe("when a screen asks the session anything", () => {
    it("refuses by name rather than answering an empty permission set", () => {
      const { transport } = recordingTransport();
      let refusal: unknown;

      function Probe() {
        const { session } = useUiCapabilities();
        try {
          session.hasPermission("datasets:view");
        } catch (error) {
          refusal = error;
        }
        return <div data-testid="probe" />;
      }

      renderSession({ path: "/acme-app/traces", transport, page: <Probe />, live: false });

      expect(refusal).toBeInstanceOf(UiCapabilityUnavailableError);
      expect((refusal as UiCapabilityUnavailableError).capability).toBe("session");
    });
  });
});

describe("given a composition that installs a session of its own", () => {
  describe("when the deployment's own session is also available", () => {
    it("answers with the installed one", async () => {
      const { transport } = recordingTransport();

      const view = renderSession({
        path: "/acme-app/traces",
        transport,
        page: <ScopeProbe />,
        installed: new StubSession(),
      });

      await waitFor(() => expect(view.getByTestId("user").textContent).toBe("installed-user"));
      expect(view.getByTestId("project").textContent).toBe("installed-project");
    });
  });
});
