/**
 * @vitest-environment jsdom
 *
 * @regression @integration
 *
 * Regression coverage for the post-Vite-migration bug where a URL of the
 * form `/[project]/<section>` redirected to `/<realSlug>` (project home),
 * dropping the `<section>` tail. The fix preserves the sub-path when
 * redirecting due to a placeholder / unknown project slug in the URL.
 *
 * This test renders a real React Router + `useOrganizationTeamProject`
 * and asserts the URL the router lands on after the hook's redirect effect
 * runs — it is not a unit test of the pure path builder (see
 * projectSlugRedirect.unit.test.ts for that).
 */
import "@testing-library/jest-dom/vitest";

import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// test-setup.ts globally stubs ~/utils/compat/next-router with a static
// router whose pathname is always "/". The redirect effect under test
// depends on a live React Router, so we need the real compat layer here.
vi.unmock("~/utils/compat/next-router");
vi.mock("~/utils/compat/next-router", async () =>
  await vi.importActual<object>("~/utils/compat/next-router"),
);

vi.mock("../useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user-1", email: "u@example.com" } },
    status: "authenticated",
  }),
  publicRoutes: [],
  noOrgBouncerRoutes: [],
}));

vi.mock("../usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { DEMO_PROJECT_SLUG: undefined } }),
}));

const organizationsData = [
  {
    id: "org-1",
    name: "Test Org",
    members: [{ role: "ADMIN" }],
    features: [],
    teams: [
      {
        id: "team-1",
        slug: "team-1",
        members: [{ role: "ADMIN" }],
        projects: [
          {
            id: "proj-1",
            slug: "test-project",
            name: "Test Project",
          },
        ],
      },
    ],
  },
];

vi.mock("~/utils/api", () => ({
  api: {
    organization: {
      getAll: {
        useQuery: () => ({
          data: organizationsData,
          isLoading: false,
          isFetched: true,
          isRefetching: false,
        }),
      },
    },
    share: {
      getShared: {
        useQuery: () => ({ data: undefined }),
      },
    },
    project: {
      publicGetById: {
        useQuery: () => ({ data: undefined }),
      },
    },
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

function ProbeWithHook() {
  useOrganizationTeamProject();
  const location = useLocation();
  return <span data-testid="current-url">{location.pathname + location.search}</span>;
}

function renderAtUrl(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/" element={<ProbeWithHook />} />
        <Route path="/:project" element={<ProbeWithHook />} />
        <Route path="/:project/*" element={<ProbeWithHook />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("useOrganizationTeamProject() redirect when project slug doesn't match", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("selectedProjectSlug", JSON.stringify("test-project"));
    localStorage.setItem("selectedOrganizationId", JSON.stringify("org-1"));
    localStorage.setItem("selectedTeamId", JSON.stringify("team-1"));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given a URL with a placeholder project slug '[project]'", () => {
    describe("when there is a section in the sub-path", () => {
      it("redirects to /<realSlug>/<section>, preserving the tail", async () => {
        const { getByTestId } = renderAtUrl("/[project]/evaluations");

        await waitFor(() => {
          expect(getByTestId("current-url").textContent).toBe(
            "/test-project/evaluations"
          );
        });
      });
    });

    describe("when there is a nested sub-path", () => {
      it("preserves the full tail", async () => {
        const { getByTestId } = renderAtUrl(
          "/[project]/annotations/my-queue"
        );

        await waitFor(() => {
          expect(getByTestId("current-url").textContent).toBe(
            "/test-project/annotations/my-queue"
          );
        });
      });
    });

    describe("when there is a query string", () => {
      it("preserves the query string", async () => {
        const { getByTestId } = renderAtUrl(
          "/[project]/messages?topics=greeting"
        );

        await waitFor(() => {
          expect(getByTestId("current-url").textContent).toBe(
            "/test-project/messages?topics=greeting"
          );
        });
      });
    });

    describe("when there is no sub-path", () => {
      it("redirects to the real project home", async () => {
        const { getByTestId } = renderAtUrl("/[project]");

        await waitFor(() => {
          expect(getByTestId("current-url").textContent).toBe("/test-project");
        });
      });
    });
  });

  describe("given a URL with an unknown project slug", () => {
    it("redirects to /<realSlug>/<section>, preserving the tail", async () => {
      const { getByTestId } = renderAtUrl(
        "/some-stale-slug/evaluations/new"
      );

      await waitFor(() => {
        expect(getByTestId("current-url").textContent).toBe(
          "/test-project/evaluations/new"
        );
      });
    });

    it("preserves a return_to query param carried on the current URL", async () => {
      const { getByTestId } = renderAtUrl(
        "/some-stale-slug?return_to=%2Fauthorize"
      );

      await waitFor(() => {
        expect(getByTestId("current-url").textContent).toBe(
          "/test-project?return_to=%2Fauthorize"
        );
      });
    });
  });

  describe("given a URL with a reserved project slug like '/evaluations' (legacy top-level shorthand)", () => {
    it("redirects to /<realSlug>/evaluations (existing behavior, unchanged)", async () => {
      const { getByTestId } = renderAtUrl("/evaluations");

      await waitFor(() => {
        expect(getByTestId("current-url").textContent).toBe(
          "/test-project/evaluations"
        );
      });
    });
  });

  describe("given a URL where the slug already matches the real project", () => {
    it("does not redirect", async () => {
      const { getByTestId } = renderAtUrl("/test-project/evaluations");

      // give the hook an opportunity to fire any effect
      await new Promise((r) => setTimeout(r, 100));

      expect(getByTestId("current-url").textContent).toBe(
        "/test-project/evaluations"
      );
    });
  });
});
