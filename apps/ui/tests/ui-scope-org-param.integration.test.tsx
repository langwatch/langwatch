/**
 * @vitest-environment jsdom
 *
 * The one-shot `?org=<slug>` switch, driven through the real router and the
 * real remembered selection: what the address carries decides which
 * organization the page is about, and the parameter never survives the visit.
 *
 * Spec: specs/ai-gateway/governance/org-query-param-switch.feature
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UiRpcContextProvider, UiRpcPort, type UiRpcSubscription } from "../src/behavior/ui-rpc";
import { useUiOrgQueryParamSelection } from "../src/behavior/ui-scope-org-param";
import {
  UI_SELECTED_ORGANIZATION_ID_KEY,
  UI_SELECTED_PROJECT_SLUG_KEY,
  UI_SELECTED_TEAM_ID_KEY,
} from "../src/behavior/ui-scope-storage";

const ORGANIZATIONS = [
  { id: "org-alpha", slug: "alpha" },
  { id: "org-beta", slug: "beta" },
];

const ROUTE_PATHS = ["/me", "/settings", "/gateway/virtual-keys"];

const query = vi.fn((_path: string) => Promise.resolve(ORGANIZATIONS as unknown));

/** Answers `organization.getAll` and refuses everything a page has no business asking here. */
class RecordedUiRpc extends UiRpcPort {
  query(path: string): Promise<unknown> {
    return query(path);
  }

  mutate(): Promise<unknown> {
    throw new Error("the `?org=` switch mutates nothing");
  }

  subscribe(): UiRpcSubscription {
    throw new Error("the `?org=` switch subscribes to nothing");
  }
}

let dispose: (() => void) | undefined;

/** The address after the switch has had its say, once the graph has arrived. */
function selectedOrganization(): string {
  return JSON.parse(window.localStorage.getItem(UI_SELECTED_ORGANIZATION_ID_KEY) ?? '""') as string;
}

function rememberOrganization(organizationId: string): void {
  window.localStorage.setItem(UI_SELECTED_ORGANIZATION_ID_KEY, JSON.stringify(organizationId));
  window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, JSON.stringify("team-shared"));
  window.localStorage.setItem(UI_SELECTED_PROJECT_SLUG_KEY, JSON.stringify("acme-app"));
}

function openAt(path: string): { address: () => string } {
  let address = path;

  function Probe() {
    useUiOrgQueryParamSelection();
    const location = useLocation();
    address = `${location.pathname}${location.search}`;
    return null;
  }

  const router = createMemoryRouter(
    ROUTE_PATHS.map((routePath) => ({ path: routePath, element: <Probe /> })),
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <UiRpcContextProvider value={new RecordedUiRpc()}>
        <RouterProvider router={router} />
      </UiRpcContextProvider>
    </QueryClientProvider>,
  );
  dispose = () => {
    view.unmount();
    router.dispose();
  };

  return { address: () => address };
}

describe("given a reader who belongs to more than one organization", () => {
  beforeEach(() => {
    window.localStorage.clear();
    query.mockClear();
  });

  afterEach(() => {
    dispose?.();
    dispose = void 0;
  });

  describe("when a page is opened with an `?org=` they belong to", () => {
    /** @scenario "Visiting an org-scoped page with `?org=<slug>` selects that org" */
    it("selects that organization and strips the parameter", async () => {
      rememberOrganization("org-alpha");
      const page = openAt("/me?org=beta");

      await waitFor(() => expect(selectedOrganization()).toBe("org-beta"));
      await waitFor(() => expect(page.address()).toBe("/me"));
    });

    /** @scenario "The `?org=` switch works on any org-scoped page, preserving the path" */
    it("switches on any org-scoped page, leaving the path it was opened at", async () => {
      rememberOrganization("org-alpha");
      const page = openAt("/gateway/virtual-keys?org=beta");

      await waitFor(() => expect(selectedOrganization()).toBe("org-beta"));
      await waitFor(() => expect(page.address()).toBe("/gateway/virtual-keys"));
    });

    /** @scenario "Other query parameters are preserved when `?org` is stripped" */
    it("removes only the org parameter", async () => {
      const page = openAt("/settings?org=beta&tab=billing");

      await waitFor(() => expect(selectedOrganization()).toBe("org-beta"));
      await waitFor(() => expect(page.address()).toBe("/settings?tab=billing"));
    });
  });

  describe("when a page is opened with an `?org=` they do not belong to", () => {
    /** @scenario "An `?org=<slug>` the user does not belong to is ignored" */
    it("keeps the organization they were on and still strips the parameter", async () => {
      rememberOrganization("org-alpha");
      const page = openAt("/me?org=not-a-member");

      await waitFor(() => expect(page.address()).toBe("/me"));
      expect(selectedOrganization()).toBe("org-alpha");
    });
  });

  describe("when a page is opened with no `?org` at all", () => {
    /** @scenario "A page without `?org` leaves the remembered organization untouched" */
    it("leaves the remembered organization alone and asks for no graph", async () => {
      rememberOrganization("org-beta");
      const page = openAt("/me");

      await waitFor(() => expect(page.address()).toBe("/me"));
      expect(selectedOrganization()).toBe("org-beta");
      expect(query).not.toHaveBeenCalled();
    });
  });
});
