/**
 * @vitest-environment jsdom
 *
 * Regression tests for the `lastVisitedHomeKind` marker writes (PR #6931).
 *
 * usehooks-ts dispatches a synchronous storage event on every write, which
 * setStates every mounted subscriber. An unguarded write therefore re-fires on
 * every effect pass with refetched identities, and inside a route transition's
 * passive-effect cascade that storm trips React's nested-update clamp
 * (React #185) and wedges navigation. The write must be idempotent, and it
 * must key off the VALIDATED project slug — reserved top-level routes like
 * /messages also bind `:project`, and counting those as project visits would
 * clobber MyLayout's "personal" marker.
 *
 * Same boundary-stubbing setup as the personal-workspace resolution tests:
 * the real hook runs; tRPC, router, session, and localStorage are stubbed.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOrganizationsQuery,
  mockRouter,
  mockLocalStorage,
  storageWrites,
  idleQuery,
} = vi.hoisted(() => ({
  mockOrganizationsQuery: vi.fn(),
  idleQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetched: true,
  }),
  mockRouter: {
    query: {} as Record<string, string>,
    route: "/",
    pathname: "/",
    asPath: "/",
    push: vi.fn(),
    replace: vi.fn(),
  },
  mockLocalStorage: {
    selectedOrganizationId: "",
    selectedTeamId: "",
    selectedProjectSlug: "",
    lastVisitedHomeKind: "",
  } as Record<string, string>,
  /** Every setter invocation, per key — the storm surface under test. */
  storageWrites: {} as Record<string, string[]>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: { getAll: { useQuery: mockOrganizationsQuery } },
    sharedTrace: { get: { useQuery: idleQuery } },
    publicEnv: { useQuery: idleQuery },
    modelProvider: { getAllForProject: { useQuery: idleQuery } },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-jane" } },
    status: "authenticated",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

// Real usehooks-ts semantics minus the storage-event fan-out, plus a write
// log: the assertions here are about WHEN the setter fires, since in the real
// hook every firing broadcasts a storage event to all subscribers.
vi.mock("usehooks-ts", () => ({
  useLocalStorage: (key: string, initial: string) => [
    mockLocalStorage[key] ?? initial,
    (value: string) => {
      mockLocalStorage[key] = value;
      (storageWrites[key] ??= []).push(value);
    },
  ],
}));

import {
  loadedOrganizationsQuery,
  PERSONAL_TEAM,
  SHARED_TEAM,
} from "~/test-utils/personalWorkspaceOrganization";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

function renderResolution() {
  return renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    }),
  );
}

describe("useOrganizationTeamProject lastVisitedHomeKind marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.query = {};
    mockRouter.route = "/";
    mockRouter.pathname = "/";
    mockRouter.asPath = "/";
    for (const key of Object.keys(mockLocalStorage)) {
      mockLocalStorage[key] = "";
    }
    for (const key of Object.keys(storageWrites)) {
      delete storageWrites[key];
    }
    mockOrganizationsQuery.mockReturnValue(
      loadedOrganizationsQuery([PERSONAL_TEAM, SHARED_TEAM]),
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a real project page named in the address bar", () => {
    beforeEach(() => {
      mockRouter.query = { project: "acme-app" };
      mockRouter.route = "/[project]/traces";
      mockRouter.pathname = "/[project]/traces";
      mockRouter.asPath = "/acme-app/traces";
    });

    /** @scenario A first project visit marks the home preference */
    it("writes the marker once when it is not set yet", () => {
      renderResolution();

      expect(storageWrites.lastVisitedHomeKind).toEqual(["project"]);
    });

    /** @scenario A repeat visit must not re-broadcast a storage event */
    it("does not write again when the marker already says project", () => {
      mockLocalStorage.lastVisitedHomeKind = "project";

      renderResolution();

      expect(storageWrites.lastVisitedHomeKind).toBeUndefined();
    });
  });

  describe("given a reserved top-level route that also binds :project", () => {
    beforeEach(() => {
      // /messages parses as /[project] with project="messages". The project
      // context still resolves — from the persisted selection — so an
      // unvalidated `router.query.project` check would count this as a
      // project visit.
      mockRouter.query = { project: "messages" };
      mockRouter.route = "/[project]";
      mockRouter.pathname = "/[project]";
      mockRouter.asPath = "/messages";
      mockLocalStorage.selectedProjectSlug = "acme-app";
      mockLocalStorage.lastVisitedHomeKind = "personal";
    });

    /** @scenario Visiting /messages is not a project-home visit */
    it("leaves a personal marker alone", () => {
      renderResolution();

      expect(storageWrites.lastVisitedHomeKind).toBeUndefined();
      expect(mockLocalStorage.lastVisitedHomeKind).toBe("personal");
    });
  });

  describe("given a slug-less page where the project resolves from the persisted selection", () => {
    beforeEach(() => {
      mockRouter.route = "/me";
      mockRouter.pathname = "/me";
      mockRouter.asPath = "/me";
      mockLocalStorage.selectedProjectSlug = "acme-app";
      mockLocalStorage.lastVisitedHomeKind = "personal";
    });

    /** @scenario A resolved-but-not-addressed project is not a project visit */
    it("does not clobber the personal marker", () => {
      renderResolution();

      expect(storageWrites.lastVisitedHomeKind).toBeUndefined();
      expect(mockLocalStorage.lastVisitedHomeKind).toBe("personal");
    });
  });
});
