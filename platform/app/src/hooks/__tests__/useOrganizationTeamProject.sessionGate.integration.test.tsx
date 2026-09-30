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
    authz: { effectivePermissions: { useQuery: idleQuery } },
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
  return renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    }),
  );
}

/** What the last render told a screen about the workspace. */
function workspaceIsResolving(
  rendered: ReturnType<typeof mount>,
): boolean | undefined {
  return rendered.result.current.isLoading;
}

/** The refusal the last render carried, when the workspace read failed. */
function workspaceFailure(rendered: ReturnType<typeof mount>): unknown {
  return rendered.result.current.workspaceError;
}

/** The shape React Query reports for a query it was told not to run. */
function switchedOff() {
  return {
    data: undefined,
    isLoading: false,
    isFetched: false,
    isError: false,
    isRefetching: false,
  };
}

/** The shape it reports while the request is actually in flight. */
function inFlight() {
  return {
    data: undefined,
    isLoading: true,
    isFetched: false,
    isError: false,
    isRefetching: false,
  };
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

/**
 * A disabled query and a query that answered with nothing are the same shape:
 * no data, `isLoading: false`. Every caller reads the second one as fact, so
 * the first has to be reported as "still resolving" or the project chrome 404s
 * and the landing redirect sends a member to onboarding.
 *
 * Spec: specs/navigation/workspace-resolution.feature
 */
describe("given a screen asking what workspace it is in", () => {
  describe("when the session has not resolved yet", () => {
    /** @scenario "The workspace is still resolving while the session is" */
    it("reports the workspace as still resolving", () => {
      session.status = "loading";
      session.data = null;
      mockOrganizationsQuery.mockReturnValue(switchedOff());

      expect(workspaceIsResolving(mount())).toBe(true);
    });
  });

  describe("when the session has resolved and the graph is being read", () => {
    /** @scenario "The workspace is still resolving while the organization graph is read" */
    it("reports the workspace as still resolving", () => {
      session.status = "authenticated";
      session.data = { user: { id: "user-jane" } };
      mockOrganizationsQuery.mockReturnValue(inFlight());

      expect(workspaceIsResolving(mount())).toBe(true);
    });
  });

  describe("when the graph has answered", () => {
    /** @scenario "A workspace whose graph has answered has resolved" */
    it("reports the workspace as resolved", () => {
      session.status = "authenticated";
      session.data = { user: { id: "user-jane" } };
      mockOrganizationsQuery.mockReturnValue({
        data: [],
        isLoading: false,
        isFetched: true,
        isError: false,
        isRefetching: false,
      });

      expect(workspaceIsResolving(mount())).toBe(false);
    });
  });

  describe("when the address is one anybody can open", () => {
    /** @scenario "An address anybody can open resolves without waiting for a graph" */
    it("reports the workspace as resolved rather than waiting for a graph it never asks for", () => {
      mockRouter.route = "/auth/signin";
      session.status = "unauthenticated";
      session.data = null;
      mockOrganizationsQuery.mockReturnValue(switchedOff());

      expect(workspaceIsResolving(mount())).toBe(false);
    });

    // The session is still in flight on the first render of every page, this
    // one included. Counting that wait here would hold the share page and the
    // sign-in screen behind a read whose answer cannot change what they draw.
    /** @scenario "An address anybody can open does not wait for the session either" */
    it("reports the workspace as resolved while the session is still being read", () => {
      mockRouter.route = "/share/[id]";
      session.status = "loading";
      session.data = null;
      mockOrganizationsQuery.mockReturnValue(switchedOff());

      expect(workspaceIsResolving(mount())).toBe(false);
    });
  });

  describe("when the graph refused the read", () => {
    /** @scenario "A graph that refused the read is not a graph still reading" */
    it("carries the refusal rather than reporting another moment of resolving", () => {
      session.status = "authenticated";
      session.data = { user: { id: "user-jane" } };
      const refusal = new Error("UNAUTHORIZED");
      mockOrganizationsQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isFetched: true,
        isError: true,
        error: refusal,
        isRefetching: false,
      });

      const rendered = mount();

      // Resolved AND failed: a refusal is an answer, so nothing waits on it.
      // What it is not is an empty graph, which is why the refusal itself has
      // to travel — `organizations` is `undefined` for both.
      expect(workspaceIsResolving(rendered)).toBe(false);
      expect(workspaceFailure(rendered)).toBe(refusal);
    });
  });
});
