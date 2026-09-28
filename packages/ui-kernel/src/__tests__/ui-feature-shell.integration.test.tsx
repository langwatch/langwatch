import { UiScope, UiSession, useUiCapabilities } from "@langwatch/browser-host/capabilities";
import type { UiFeatureApiBinding, UiFeatureApiTransport } from "@langwatch/browser-host/transport";
import {
  createUiScopeHost,
  useOrganizationTeamProject,
} from "@langwatch/browser-host/use-organization-team-project";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createUiFeatureShell } from "../ui-feature-shell.tsx";
import type { UiProviderShell } from "../ui-outer-providers.tsx";

/** Namespaced as auth's own query key would be; nothing here reads a real one. */
const TEST_SESSION_QUERY_KEY = ["test", "session"];

class StubSession extends UiSession {
  currentUser() {
    return { id: "user_1", name: "Ada", email: "ada@example.com", image: null };
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

class StubScope extends UiScope {
  activeScope() {
    return { organizationId: "org_1", projectId: "project_1" };
  }
}

/** A scope that has resolved, and publishes it on the shared host. */
class ResolvedScope extends StubScope {
  override scopeHost() {
    return createUiScopeHost({
      project: () => ({ id: "project_1", slug: "ada-project", name: "Ada's project" }),
      organization: () => ({ id: "org_1", name: "Ada Ltd" }),
      team: () => void 0,
      hasPermission: (permission) => permission === "traces:read",
    });
  }
}

/** What one feature-api Provider was handed, recorded as it mounts. */
type Mount = { name: string; client: unknown; queryClient: QueryClient };

function recordingBinding(name: string, mounts: Mount[]): UiFeatureApiBinding {
  return {
    name,
    Provider: ({
      client,
      queryClient,
      children,
    }: {
      client: unknown;
      queryClient: QueryClient;
      children: ReactNode;
    }) => {
      mounts.push({ name, client, queryClient });
      return <div data-testid={`api-${name}`}>{children}</div>;
    },
  };
}

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = void 0;
});

function renderShell(Shell: UiProviderShell, page: ReactNode, host?: QueryClient, entry = "/") {
  const inside = <Shell>{page}</Shell>;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: host ? <QueryClientProvider client={host}>{inside}</QueryClientProvider> : inside,
      },
    ],
    { initialEntries: [entry] },
  );
  const view = render(<RouterProvider router={router} />);
  dispose = () => {
    view.unmount();
    router.dispose();
  };
  return view;
}

describe("given the shell apps/ui mounts around every routed page", () => {
  describe("when a screen asks for a capability", () => {
    it("answers with the port the composition installed", () => {
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [],
        capabilities: { session: new StubSession(), scope: new StubScope() },
        transport: {} as UiFeatureApiTransport,
      });

      function Page() {
        return <div data-testid="who">{useUiCapabilities().session.currentUser()?.id}</div>;
      }

      const view = renderShell(shell, <Page />);

      expect(view.getByTestId("who").textContent).toBe("user_1");
    });
  });

  describe("when a drawer reads the host a module mounts", () => {
    /** @scenario "A module's host is mounted above an open drawer too" */
    it("renders the drawer inside the module host stack", async () => {
      const ProbeHost = createContext<string | null>(null);
      function ModuleHosts({ children }: { children?: ReactNode }) {
        return <ProbeHost.Provider value="mounted">{children}</ProbeHost.Provider>;
      }
      function ProbeDrawer() {
        return <div data-testid="drawer-host">{useContext(ProbeHost) ?? "missing"}</div>;
      }
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [],
        capabilities: { session: new StubSession(), scope: new StubScope() },
        transport: {} as UiFeatureApiTransport,
        drawers: { probe: ProbeDrawer },
        moduleHosts: ModuleHosts,
      });

      const view = renderShell(shell, <div />, void 0, "/?drawer.open=probe");

      await waitFor(() => expect(view.getByTestId("drawer-host").textContent).toBe("mounted"));
    });
  });

  describe("when the shell renders inside a host that already has a QueryClient", () => {
    it("hands every feature Provider that same client, so one cache serves both halves", () => {
      const mounts: Mount[] = [];
      const host = new QueryClient();
      const transport = {} as UiFeatureApiTransport;
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [recordingBinding("prompt", mounts)],
        capabilities: {},
        transport,
      });

      renderShell(shell, <div data-testid="page" />, host);

      expect(mounts).toHaveLength(1);
      expect(mounts[0]?.queryClient).toBe(host);
      expect(mounts[0]?.client).toBe(transport);
    });
  });

  describe("when the shell renders with no host QueryClient above it", () => {
    it("supplies one of its own rather than throwing on the first hook", () => {
      let seen: QueryClient | undefined;
      const mounts: Mount[] = [];
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [recordingBinding("prompt", mounts)],
        capabilities: {},
        transport: {} as UiFeatureApiTransport,
      });

      function Page() {
        seen = useQueryClient();
        return <div data-testid="page" />;
      }

      renderShell(shell, <Page />);

      expect(seen).toBeInstanceOf(QueryClient);
      expect(mounts[0]?.queryClient).toBe(seen);
    });
  });

  describe("when an installed feature answers one class of failure application-wide", () => {
    it("runs its interceptor on every failed mutation, with the host it can act through", async () => {
      const seen: { message: string; navigated: string[] }[] = [];
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [],
        capabilities: {},
        transport: {} as UiFeatureApiTransport,
        failures: [
          (error, host) => {
            const navigated: string[] = [];
            // The one route this memory router serves: what is proven here is
            // that the interceptor CAN navigate, not where it goes.
            host.navigate("/");
            navigated.push("/");
            seen.push({ message: (error as Error).message, navigated });
            return true;
          },
        ],
      });

      function Page() {
        const mutation = useMutation({
          mutationFn: () => Promise.reject(new Error("no model configured")),
        });
        return (
          <button type="button" data-testid="go" onClick={() => mutation.mutate()}>
            go
          </button>
        );
      }

      const view = renderShell(shell, <Page />);
      view.getByTestId("go").click();

      await waitFor(() => {
        expect(seen).toEqual([{ message: "no model configured", navigated: ["/"] }]);
      });
    });
  });

  describe("when several feature packages are installed", () => {
    it("mounts them in declaration order, first one outermost", () => {
      const mounts: Mount[] = [];
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [recordingBinding("prompt", mounts), recordingBinding("trace", mounts)],
        capabilities: {},
        transport: {} as UiFeatureApiTransport,
      });

      const view = renderShell(shell, <div data-testid="page" />);

      expect(mounts.map((mount) => mount.name)).toEqual(["prompt", "trace"]);
      expect(view.getByTestId("api-prompt").contains(view.getByTestId("api-trace"))).toBe(true);
    });
  });

  describe("when a screen from any feature reads the shared organization, team and project hook", () => {
    /** @scenario "The application session publishes the scope every feature reads" */
    it("sees the project, the organization and the grants the session resolved", () => {
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [],
        capabilities: { session: new StubSession(), scope: new ResolvedScope() },
        transport: {} as UiFeatureApiTransport,
      });

      function Page() {
        const scope = useOrganizationTeamProject();
        return (
          <div data-testid="scope">
            {scope.project?.slug}|{scope.organization?.id}|
            {String(scope.hasPermission("traces:read"))}|
            {String(scope.hasPermission("traces:delete"))}
          </div>
        );
      }

      const view = renderShell(shell, <Page />);

      expect(view.getByTestId("scope").textContent).toBe("ada-project|org_1|true|false");
    });

    /** @scenario "A session with no resolved scope leaves the shared hook unresolved rather than throwing" */
    it("reads unresolved with no project and no grants when the session publishes no scope", () => {
      const shell = createUiFeatureShell({
        sessionQueryKey: TEST_SESSION_QUERY_KEY,
        apis: [],
        capabilities: { session: new StubSession(), scope: new StubScope() },
        transport: {} as UiFeatureApiTransport,
      });

      function Page() {
        const scope = useOrganizationTeamProject();
        return (
          <div data-testid="scope">
            {String(scope.isResolved)}|{JSON.stringify(scope.project) ?? "undefined"}|
            {String(scope.hasPermission("traces:read"))}
          </div>
        );
      }

      const view = renderShell(shell, <Page />);

      expect(view.getByTestId("scope").textContent).toBe("false|undefined|false");
    });
  });
});
