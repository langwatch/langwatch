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
 * Unlike the sibling resolution tests, `usehooks-ts` is NOT stubbed here: the
 * real `useLocalStorage` runs against jsdom's localStorage, so every marker
 * write executes the actual `StorageEvent("local-storage")` fan-out. A probe
 * subscriber mounted on the same key (standing in for MyLayout's reader)
 * observes whether that cascade fires. tRPC, router, and session are stubbed.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { useLocalStorage } from "usehooks-ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOrganizationsQuery, mockRouter, idleQuery } = vi.hoisted(() => ({
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

import {
  loadedOrganizationsQuery,
  PERSONAL_TEAM,
  SHARED_TEAM,
} from "~/test-utils/personalWorkspaceOrganization";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

/** usehooks-ts JSON-serializes values; seeds must match its wire format. */
function seedStorage(key: string, value: string) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readMarker(): string | null {
  const raw = window.localStorage.getItem("lastVisitedHomeKind");
  return raw === null ? null : (JSON.parse(raw) as string);
}

function renderResolution() {
  return renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    }),
  );
}

/**
 * A mounted subscriber on the marker key, like MyLayout's reader in the real
 * app. Every marker write broadcasts a storage event that re-renders it, so
 * its render count observes the fan-out cascade directly.
 */
function renderMarkerProbe(renders: { count: number }) {
  return renderHook(() => {
    renders.count += 1;
    const [kind] = useLocalStorage("lastVisitedHomeKind", "");
    return kind;
  });
}

describe("useOrganizationTeamProject lastVisitedHomeKind marker", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let markerWrites: () => number;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockRouter.query = {};
    mockRouter.route = "/";
    mockRouter.pathname = "/";
    mockRouter.asPath = "/";
    mockOrganizationsQuery.mockReturnValue(
      loadedOrganizationsQuery([PERSONAL_TEAM, SHARED_TEAM]),
    );
    setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    markerWrites = () =>
      setItemSpy.mock.calls.filter(
        ([key]: [string, string]) => key === "lastVisitedHomeKind",
      ).length;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a real project page named in the address bar", () => {
    beforeEach(() => {
      mockRouter.query = { project: "acme-app" };
      mockRouter.route = "/[project]/traces";
      mockRouter.pathname = "/[project]/traces";
      mockRouter.asPath = "/acme-app/traces";
    });

    /** @scenario A first project visit writes the home marker exactly once */
    it("writes the marker once and the fan-out reaches subscribers exactly once", () => {
      const probeRenders = { count: 0 };
      const probe = renderMarkerProbe(probeRenders);
      const rendersBeforeHook = probeRenders.count;

      renderResolution();

      expect(readMarker()).toBe("project");
      // The real storage event reached the mounted subscriber…
      expect(probe.result.current).toBe("project");
      // …exactly once: an unguarded write re-broadcasts on every effect
      // pass, which is the cascade that tripped React's clamp.
      expect(markerWrites()).toBe(1);
      expect(probeRenders.count).toBe(rendersBeforeHook + 1);
    });

    /** @scenario A repeat visit must not re-broadcast a storage event */
    it("does not write or broadcast when the marker already says project", () => {
      seedStorage("lastVisitedHomeKind", "project");
      const probeRenders = { count: 0 };
      renderMarkerProbe(probeRenders);
      const rendersBeforeHook = probeRenders.count;
      setItemSpy.mockClear(); // discard the seeding write itself

      renderResolution();

      expect(markerWrites()).toBe(0);
      // No broadcast → the mounted subscriber never re-rendered. Before the
      // guard, this path setStated every subscriber on every effect pass.
      expect(probeRenders.count).toBe(rendersBeforeHook);
      expect(readMarker()).toBe("project");
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
      seedStorage("selectedProjectSlug", "acme-app");
      seedStorage("lastVisitedHomeKind", "personal");
    });

    /** @scenario Visiting /messages is not a project-home visit */
    it("leaves a personal marker alone", () => {
      setItemSpy.mockClear(); // discard the seeding writes themselves

      renderResolution();

      expect(markerWrites()).toBe(0);
      expect(readMarker()).toBe("personal");
    });
  });

  describe("given a slug-less page where the project resolves from the persisted selection", () => {
    beforeEach(() => {
      mockRouter.route = "/me";
      mockRouter.pathname = "/me";
      mockRouter.asPath = "/me";
      seedStorage("selectedProjectSlug", "acme-app");
      seedStorage("lastVisitedHomeKind", "personal");
    });

    /** @scenario A resolved-but-not-addressed project is not a project visit */
    it("does not clobber the personal marker", () => {
      setItemSpy.mockClear(); // discard the seeding writes themselves

      renderResolution();

      expect(markerWrites()).toBe(0);
      expect(readMarker()).toBe("personal");
    });
  });
});
