/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

let mockParams: URLSearchParams;
const mockSetSearchParams = vi.fn();
vi.mock("react-router", () => ({
  useSearchParams: () => [mockParams, mockSetSearchParams],
}));

let mockOrganizations: Array<{ id: string; slug: string }> | undefined;
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ organizations: mockOrganizations }),
}));

const mockSetSelectedOrganizationId = vi.fn();
vi.mock("usehooks-ts", () => ({
  useLocalStorage: () => ["", mockSetSelectedOrganizationId],
}));

import { useOrgQueryParamSelection } from "../useOrgQueryParamSelection";

/** Apply the strip updater the hook passes to setSearchParams against `from`. */
function applyStrip(from: string): URLSearchParams {
  const updater = mockSetSearchParams.mock.calls[0]?.[0] as (
    prev: URLSearchParams,
  ) => URLSearchParams;
  return updater(new URLSearchParams(from));
}

describe("useOrgQueryParamSelection", () => {
  beforeEach(() => {
    mockSetSearchParams.mockClear();
    mockSetSelectedOrganizationId.mockClear();
    mockOrganizations = [
      { id: "org_alpha", slug: "alpha" },
      { id: "org_beta", slug: "beta" },
    ];
    mockParams = new URLSearchParams();
  });

  describe("given ?org names an organization the user belongs to", () => {
    /** @scenario Visiting an org-scoped page with `?org=<slug>` selects that org */
    it("selects that org and strips the param", () => {
      mockParams = new URLSearchParams("org=beta");
      renderHook(() => useOrgQueryParamSelection());

      expect(mockSetSelectedOrganizationId).toHaveBeenCalledWith("org_beta");
      expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
      expect(applyStrip("org=beta").get("org")).toBeNull();
    });

    /** @scenario The `?org=` switch works on any org-scoped page, preserving the path */
    it("strips via replace so the page is not pushed onto history", () => {
      mockParams = new URLSearchParams("org=beta");
      renderHook(() => useOrgQueryParamSelection());

      // The hook only ever rewrites the search params (never the path), and
      // does so with { replace: true } so it does not add a history entry.
      expect(mockSetSearchParams).toHaveBeenCalledWith(expect.any(Function), {
        replace: true,
      });
    });

    /** @scenario Other query parameters are preserved when `?org` is stripped */
    it("removes only org, keeping every other parameter", () => {
      mockParams = new URLSearchParams("org=beta&tab=billing");
      renderHook(() => useOrgQueryParamSelection());

      const next = applyStrip("org=beta&tab=billing");
      expect(next.get("org")).toBeNull();
      expect(next.get("tab")).toBe("billing");
    });
  });

  describe("given ?org names an organization the user does not belong to", () => {
    /** @scenario An `?org=<slug>` the user does not belong to is ignored */
    it("does not switch but still strips the param", () => {
      mockParams = new URLSearchParams("org=not-a-member");
      renderHook(() => useOrgQueryParamSelection());

      expect(mockSetSelectedOrganizationId).not.toHaveBeenCalled();
      expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
      expect(applyStrip("org=not-a-member").get("org")).toBeNull();
    });
  });

  describe("given no ?org parameter", () => {
    /** @scenario A page without `?org` leaves the remembered organization untouched */
    it("does nothing", () => {
      mockParams = new URLSearchParams();
      renderHook(() => useOrgQueryParamSelection());

      expect(mockSetSelectedOrganizationId).not.toHaveBeenCalled();
      expect(mockSetSearchParams).not.toHaveBeenCalled();
    });
  });
});
