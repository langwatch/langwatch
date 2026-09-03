/**
 * @vitest-environment jsdom
 *
 * The organization list is asked for once the session has RESOLVED, never
 * while it is still resolving. Fired early it goes out with no cookie behind
 * it, comes back 401, and 401 is a status the retry policy will never replay —
 * so the query sits in error until something remounts an observer, and an
 * organization list that never arrives reads as an account that has none.
 *
 * Spec: specs/navigation/navigation-v2-landing.feature
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrganizationsQuery, mockRouter, idleQuery, session } = vi.hoisted(
  () => ({
    mockOrganizationsQuery: vi.fn(),
    idleQuery: () => ({
      data: undefined,
      isLoading: false,
      isFetched: true,
    }),
    session: {
      data: null as { user: { id: string } } | null,
      status: "loading" as "loading" | "authenticated" | "unauthenticated",
    },
    mockRouter: {
      query: {} as Record<string, string>,
      route: "/some-page",
      pathname: "/some-page",
      asPath: "/some-page",
      push: vi.fn(),
      replace: vi.fn(),
    },
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    organization: { getAll: { useQuery: mockOrganizationsQuery } },
    sharedTrace: { get: { useQuery: idleQuery } },
    publicEnv: { useQuery: idleQuery },
    modelProvider: { getAllForProject: { useQuery: idleQuery } },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => session,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

/** Whether the organization list was asked for on the last render. */
function askedForOrganizations(): boolean | undefined {
  const options = mockOrganizationsQuery.mock.calls.at(-1)?.[1] as
    | { enabled?: boolean }
    | undefined;
  return options?.enabled;
}

function mount() {
  renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockRouter.route = "/some-page";
  mockOrganizationsQuery.mockClear();
  mockOrganizationsQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetched: false,
    isRefetching: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("given a route that requires a session", () => {
  describe("when the session is still resolving", () => {
    it("asks for no organizations yet", () => {
      session.status = "loading";
      session.data = null;

      mount();

      expect(askedForOrganizations()).toBe(false);
    });
  });

  describe("when the session has resolved to somebody", () => {
    it("asks for their organizations", () => {
      session.status = "authenticated";
      session.data = { user: { id: "user-jane" } };

      mount();

      expect(askedForOrganizations()).toBe(true);
    });
  });

  describe("when the session has resolved to nobody", () => {
    it("asks anyway, because being refused is the answer that sends them to the door", () => {
      session.status = "unauthenticated";
      session.data = null;

      mount();

      expect(askedForOrganizations()).toBe(true);
    });
  });
});

describe("given a route anybody can open", () => {
  describe("when the session has resolved to nobody", () => {
    it("asks for nothing, because nothing on it is organization-scoped", () => {
      mockRouter.route = "/auth/signin";
      session.status = "unauthenticated";
      session.data = null;

      mount();

      expect(askedForOrganizations()).toBe(false);
    });
  });
});
