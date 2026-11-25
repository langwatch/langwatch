// @vitest-environment jsdom
/**
 * The organization host is mounted above every route, the sign-in page included.
 * Spec: modules/organization/specs/scope-graph.feature
 */
import {
  UiHostServicesContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiActor,
} from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const scopeGraph = vi.fn((_input: unknown, _options?: { enabled?: boolean }) => ({
  data: undefined,
}));
vi.mock("../organization-api.ts", () => ({
  organizationApi: {
    organization: {
      getScopeGraph: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => scopeGraph(input, options),
      },
    },
  },
}));

import { useOrganizationHost } from "../../model/organization-host.ts";
import OrganizationHostMount from "../organization-host-mount.tsx";

/** How many times the host asked the session host service to end the session. */
let signOutsAsked = 0;

class TestSession extends UiSession {
  constructor(private readonly actor: UiActor | null) {
    super();
  }

  currentUser() {
    return this.actor;
  }

  hasPermission(): boolean {
    return false;
  }

  isSettled(): boolean {
    return true;
  }

  override signOut(): Promise<void> {
    signOutsAsked += 1;
    return Promise.resolve();
  }
}

class SignedOutScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: null, projectId: null };
  }
}

/** A settings screen's own sign-out control, which asks its host rather than the address bar. */
function SignOutControl() {
  const host = useOrganizationHost();
  return (
    <button type="button" onClick={() => host.signOut()}>
      Sign out
    </button>
  );
}

function renderOnSignIn(actor: UiActor | null, children?: ReactNode) {
  const services = {
    ...createUiHostServicesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new TestSession(actor),
    ),
    scope: new SignedOutScope(),
  };
  render(
    <MemoryRouter initialEntries={["/auth/signin"]}>
      <QueryClientProvider client={new QueryClient()}>
        <UiHostServicesContextProvider value={services}>
          <OrganizationHostMount>{children}</OrganizationHostMount>
        </UiHostServicesContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const asked = () => scopeGraph.mock.calls.some(([, options]) => options?.enabled !== false);

afterEach(() => {
  cleanup();
  scopeGraph.mockClear();
  signOutsAsked = 0;
});

describe("given the organization host mounted above the sign-in page", () => {
  describe("when nobody is signed in", () => {
    /** @scenario "The sign-in page sends no authenticated query" */
    it("never asks for the scope graph", () => {
      renderOnSignIn(null);

      expect(scopeGraph).toHaveBeenCalled();
      expect(asked()).toBe(false);
    });
  });

  describe("when a reader is signed in", () => {
    it("asks for the scope graph", () => {
      renderOnSignIn({ id: "user-1", name: "Reader", email: "reader@example.com", image: null });

      expect(asked()).toBe(true);
    });
  });

  describe("when a screen below it uses its own sign-out control", () => {
    /** @scenario "A screen's sign-out control ends the session through the one owner of sign-out" */
    it("asks the session host service to sign out, rather than navigating by hand", () => {
      renderOnSignIn(
        { id: "user-1", name: "Reader", email: "reader@example.com", image: null },
        <SignOutControl />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

      expect(signOutsAsked).toBe(1);
    });
  });
});
