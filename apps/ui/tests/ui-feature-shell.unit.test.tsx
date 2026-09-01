import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
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

  isFeatureEnabled(): boolean {
    return true;
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
});
