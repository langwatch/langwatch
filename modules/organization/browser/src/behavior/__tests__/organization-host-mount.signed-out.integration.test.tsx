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
import { cleanup, render } from "@testing-library/react";
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

import OrganizationHostMount from "../organization-host-mount.tsx";

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
}

class SignedOutScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: null, projectId: null };
  }
}

function renderOnSignIn(actor: UiActor | null) {
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
          <OrganizationHostMount />
        </UiHostServicesContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const asked = () => scopeGraph.mock.calls.some(([, options]) => options?.enabled !== false);

afterEach(() => {
  cleanup();
  scopeGraph.mockClear();
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
});
