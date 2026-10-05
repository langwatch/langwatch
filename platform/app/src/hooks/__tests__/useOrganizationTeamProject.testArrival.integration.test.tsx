/**
 * @vitest-environment jsdom
 *
 * A single sign-on test sign-in returns to the setup screen, an
 * organization-scoped page. The tester belongs to no organization, so the
 * orgless bounce runs there, and it must send them to the test sign-in result
 * rather than to the screen that creates an organization.
 *
 * Spec: specs/identity/sso-activation.feature
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockTestArrivalQuery, mockRouter, idleQuery } = vi.hoisted(() => ({
  mockTestArrivalQuery: vi.fn(),
  idleQuery: () => ({
    data: undefined,
    isLoading: false,
    isFetched: true,
  }),
  mockRouter: {
    query: { ssoTest: "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m" } as Record<
      string,
      string
    >,
    route: "/settings/authentication/provider",
    pathname: "/settings/authentication/provider",
    asPath:
      "/settings/authentication/provider?ssoTest=local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m",
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: {
      getAll: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isFetched: true,
          isRefetching: false,
        }),
      },
    },
    identity: { myTestArrival: { useQuery: mockTestArrivalQuery } },
    authz: { effectivePermissions: { useQuery: idleQuery } },
    sharedTrace: { get: { useQuery: idleQuery } },
    publicEnv: { useQuery: idleQuery },
    modelProvider: { getAllForProject: { useQuery: idleQuery } },
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-alice" } },
    status: "authenticated",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => mockRouter,
}));

import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

const mount = () =>
  renderHook(() =>
    useOrganizationTeamProject({
      redirectToOnboarding: true,
      redirectToProjectOnboarding: true,
    }),
  );

beforeEach(() => {
  window.localStorage.clear();
  mockRouter.push.mockClear();
  mockTestArrivalQuery.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("useOrganizationTeamProject", () => {
  describe("when a test sign-in returns to the setup screen as somebody with no organization", () => {
    /** @scenario A test sign-in that returns to the setup screen is sent to what happened */
    it("sends them to the test sign-in result, not to onboarding", async () => {
      mockTestArrivalQuery.mockReturnValue({
        data: {
          connectionId: "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m",
          organizationId: "org_acme",
          organizationName: "Acme",
        },
        isPending: false,
      });

      mount();

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith("/auth/sso-test-complete");
      });
      expect(mockRouter.push).not.toHaveBeenCalledWith(
        expect.stringContaining("/onboarding/welcome"),
      );
      expect(mockTestArrivalQuery.mock.calls.at(-1)?.[1]).toMatchObject({
        enabled: true,
      });
    });

    /** @scenario A test sign-in that returns to the setup screen is sent to what happened */
    it("sends them nowhere while the server has not answered", async () => {
      mockTestArrivalQuery.mockReturnValue({
        data: undefined,
        isPending: true,
      });

      mount();

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  describe("when somebody with no organization is not a test arrival", () => {
    /** @scenario A test sign-in that returns to the setup screen is sent to what happened */
    it("still sends them to onboarding", async () => {
      mockTestArrivalQuery.mockReturnValue({ data: null, isPending: false });

      mount();

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith("/onboarding/welcome");
      });
    });
  });
});
