import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  createUiScopeHost,
  useOrganizationTeamProject,
} from "@langwatch/ui-host/use-organization-team-project";
import { UiSessionPort, useUiCapabilities } from "../src/behavior/ui-capabilities";
import type {
  UiFeatureApiBinding,
  UiFeatureApiTransport,
} from "../src/behavior/ui-feature-transport";
import { createUiFeatureShell } from "../src/ui/sections/ui-feature-shell";
import type { UiProviderShell } from "../src/ui/sections/ui-outer-providers";

class StubSession extends UiSessionPort {
  currentUser() {
    return { id: "user_1", name: "Ada", email: "ada@example.com", image: null };
  }

  activeScope() {
    return { organizationId: "org_1", projectId: "project_1" };
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

/** A session that has resolved its scope and publishes it on the shared port. */
class ScopedSession extends StubSession {
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

function renderShell(Shell: UiProviderShell, page: ReactNode, host?: QueryClient) {
  const inside = <Shell>{page}</Shell>;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: host ? <QueryClientProvider client={host}>{inside}</QueryClientProvider> : inside,
      },
    ],
    { initialEntries: ["/"] },
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
        apis: [],
        capabilities: { session: new StubSession() },
        transport: {} as UiFeatureApiTransport,
      });

      function Page() {
        return <div data-testid="who">{useUiCapabilities().session.currentUser()?.id}</div>;
      }

      const view = renderShell(shell, <Page />);

      expect(view.getByTestId("who").textContent).toBe("user_1");
    });
  });

  describe("when the shell renders inside a host that already has a QueryClient", () => {
    it("hands every feature Provider that same client, so one cache serves both halves", () => {
      const mounts: Mount[] = [];
      const host = new QueryClient();
      const transport = {} as UiFeatureApiTransport;
      const shell = createUiFeatureShell({
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

  describe("when several feature packages are installed", () => {
    it("mounts them in declaration order, first one outermost", () => {
      const mounts: Mount[] = [];
      const shell = createUiFeatureShell({
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
    // @scenario "The application session publishes the scope every feature reads"
    it("sees the project, the organization and the grants the session resolved", () => {
      const shell = createUiFeatureShell({
        apis: [],
        capabilities: { session: new ScopedSession() },
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

    // @scenario "A session with no resolved scope leaves the shared hook unresolved rather than throwing"
    it("reads unresolved with no project and no grants when the session publishes no scope", () => {
      const shell = createUiFeatureShell({
        apis: [],
        capabilities: { session: new StubSession() },
        transport: {} as UiFeatureApiTransport,
      });

      function Page() {
        const scope = useOrganizationTeamProject();
        return (
          <div data-testid="scope">
            {String(scope.isResolved)}|{String(scope.project)}|
            {String(scope.hasPermission("traces:read"))}
          </div>
        );
      }

      const view = renderShell(shell, <Page />);

      expect(view.getByTestId("scope").textContent).toBe("false|undefined|false");
    });
  });
});
