/**
 * The regression this lane exists to prevent: the application chrome drew a
 * bare outlet because nothing implemented `NavigationHost`. The chrome must
 * draw `NavigationShell` over a mounted host that answers the address.
 * @vitest-environment jsdom
 */

import {
  BrowserUiDocumentTitle,
  UiCapabilityContextProvider,
  UiFeedback,
  UiNavigation,
  UiRoute,
  UiRpc,
  UiSession,
  type UiActiveScope,
  type UiActor,
  type UiCapabilities,
  UiScope,
} from "@langwatch/browser-host/capabilities";
import type { UiSessionSnapshot } from "@langwatch/browser-host/session";
import { useOptionalNavigationHost } from "@langwatch/navigation-browser/navigation";
import { UiDesignSystemShell } from "@langwatch/ui-kernel/design-system-shell";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UiAppChrome from "../ui-app-chrome";

vi.mock("@langwatch/navigation-browser/chrome", () => ({
  NavigationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="navigation-shell">{children}</div>
  ),
  useNavigationTracking: () => {},
}));

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";

const GRAPH = [
  {
    id: ORGANIZATION_ID,
    name: "Acme",
    presenceEnabled: true,
    members: [{ role: "ADMIN" }],
    teams: [
      {
        id: "team_1",
        name: "Platform",
        members: [{ userId: "user_1" }],
        projects: [
          { id: PROJECT_ID, name: "My project", slug: "my-project", presenceEnabled: false },
        ],
      },
    ],
  },
];

class GraphRpc extends UiRpc {
  query(path: string): Promise<unknown> {
    if (path === "organization.getAll") return Promise.resolve(GRAPH);
    return Promise.resolve(null);
  }

  mutate(): Promise<unknown> {
    return Promise.resolve(null);
  }

  subscribe() {
    return { unsubscribe: () => void 0 };
  }
}

class SilentNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class TracesRoute extends UiRoute {
  reading() {
    return { params: { project: "my-project" }, query: {} };
  }
  setQuery(): void {}
}

class SilentFeedback extends UiFeedback {
  succeeded(): void {}
  failed(): void {}
}

class SignedInScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: ORGANIZATION_ID, projectId: PROJECT_ID };
  }
}

class SignedInSession extends UiSession {
  currentUser(): UiActor {
    return { id: "user_1", name: "Ada", email: "ada@example.com", image: null };
  }
  snapshot(): UiSessionSnapshot {
    return {
      session: { status: "authenticated", user: this.currentUser() },
      scope: {
        status: "ready",
        organization: { id: ORGANIZATION_ID },
        team: undefined,
        project: undefined,
      },
      permissions: {
        status: "ready",
        isLoading: false,
        can: () => false,
        canInOrganization: () => false,
      },
    };
  }
  hasPermission(): boolean {
    return false;
  }
  isSettled(): boolean {
    return true;
  }
  featureFlag(): boolean | undefined {
    return void 0;
  }
}

const CAPABILITIES: UiCapabilities = {
  documentTitle: BrowserUiDocumentTitle.create(),
  feedback: new SilentFeedback(),
  navigation: new SilentNavigation(),
  route: new TracesRoute(),
  rpc: new GraphRpc(),
  scope: new SignedInScope(),
  session: new SignedInSession(),
};

/** Reads the host the chrome mounted, from a page drawn inside it. */
function HostProbe() {
  const host = useOptionalNavigationHost();
  if (!host) return <div data-testid="probe">no host</div>;
  return (
    <div
      data-testid="probe"
      data-pathname={host.pathname()}
      data-project={host.project()?.slug ?? ""}
      data-presence={host.accountMenu()?.presence ? "offered" : "absent"}
      data-langy={host.langy() ? "offered" : "absent"}
      data-flag={JSON.stringify(host.featureFlag("release_langy_enabled"))}
    />
  );
}

function renderChrome() {
  return render(
    <MemoryRouter initialEntries={["/my-project/traces"]}>
      <QueryClientProvider client={new QueryClient()}>
        <UiCapabilityContextProvider value={CAPABILITIES}>
          <UiDesignSystemShell>
            <Routes>
              <Route element={<UiAppChrome />}>
                <Route path="/:project/traces" element={<HostProbe />} />
              </Route>
            </Routes>
          </UiDesignSystemShell>
        </UiCapabilityContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** jsdom answers no media query; the design system asks one on mount. */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(cleanup);

describe("the application chrome", () => {
  it("draws NavigationShell over a mounted navigation host", async () => {
    renderChrome();

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy());
    const shell = screen.getByTestId("navigation-shell");
    expect(shell.contains(screen.getByTestId("probe"))).toBe(true);
    expect(screen.getByTestId("probe").getAttribute("data-pathname")).toBe("/my-project/traces");
  });

  it("answers the workspace graph the shell read", async () => {
    renderChrome();

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-project")).toBe("my-project"),
    );
  });

  it("offers the presence toggle on the surface that broadcasts presence", async () => {
    renderChrome();

    await waitFor(() =>
      expect(screen.getByTestId("probe").getAttribute("data-presence")).toBe("offered"),
    );
  });

  it("draws the address bare when no application shell answers, rather than throwing", () => {
    render(
      <MemoryRouter initialEntries={["/my-project/traces"]}>
        <Routes>
          <Route element={<UiAppChrome />}>
            <Route path="/:project/traces" element={<HostProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("probe").textContent).toBe("no host");
    expect(screen.queryByTestId("navigation-shell")).toBeNull();
  });

  it("offers no Langy hand-off without the grant, and keeps an unanswered flag pending", async () => {
    renderChrome();

    await waitFor(() => expect(screen.getByTestId("probe")).toBeTruthy());
    expect(screen.getByTestId("probe").getAttribute("data-langy")).toBe("absent");
    expect(screen.getByTestId("probe").getAttribute("data-flag")).toBe(
      JSON.stringify({ enabled: false, isLoading: true }),
    );
  });

  describe("when the workspace read is refused", () => {
    /** @scenario "A refused workspace read offers a retry instead of loading forever" */
    it("says the workspace could not be opened and offers to try again", async () => {
      class RefusingRpc extends GraphRpc {
        override query(): Promise<unknown> {
          return Promise.reject(new Error("the workspace graph refused"));
        }
      }
      const reload = vi.fn();
      vi.spyOn(window, "location", "get").mockReturnValue(
        Object.create(window.location, { reload: { value: reload } }),
      );

      render(
        <MemoryRouter initialEntries={["/my-project/traces"]}>
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <UiCapabilityContextProvider value={{ ...CAPABILITIES, rpc: new RefusingRpc() }}>
              <UiDesignSystemShell>
                <Routes>
                  <Route element={<UiAppChrome />}>
                    <Route path="/:project/traces" element={<HostProbe />} />
                  </Route>
                </Routes>
              </UiDesignSystemShell>
            </UiCapabilityContextProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );

      const retry = await screen.findByTestId("retry-workspace");
      expect(screen.getByText("We couldn't open your workspace")).toBeTruthy();
      expect(screen.queryByTestId("probe")).toBeNull();
      retry.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
