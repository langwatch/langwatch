/**
 * @vitest-environment jsdom
 *
 * Covers the gtag/Reo retry behavior in SignedInExtraFooterComponents: since
 * GTM's container (which defines both globals) now loads via an
 * idle-deferred Script, these effects must poll instead of giving up
 * permanently on the first check. Renders the real component tree, so this
 * is an integration test.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateLastLoginMutate, mockPosthogIdentify } = vi.hoisted(() => ({
  mockUpdateLastLoginMutate: vi.fn(),
  mockPosthogIdentify: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme" },
    project: { id: "proj-1", name: "Main" },
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: {
      user: {
        id: "user-1",
        email: "user@example.com",
        name: "Test User",
        impersonator: null,
      },
    },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    user: {
      updateLastLogin: {
        useMutation: () => ({ mutate: mockUpdateLastLoginMutate }),
      },
    },
  },
}));

vi.mock("posthog-js", () => ({
  default: { identify: mockPosthogIdentify },
}));

vi.mock("~/utils/compat/next-script", () => ({
  default: () => null,
}));

import { SignedInExtraFooterComponents } from "../ExtraFooterComponents";

describe("SignedInExtraFooterComponents - gtag/Reo polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as any).gtag;
    delete (window as any).Reo;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("given gtag is not yet available on mount", () => {
    it("fires user_properties and open_dashboard once gtag appears", async () => {
      render(<SignedInExtraFooterComponents />);

      const gtag = vi.fn();
      (window as any).gtag = gtag;
      await vi.advanceTimersByTimeAsync(250);

      expect(gtag).toHaveBeenCalledWith(
        "set",
        "user_properties",
        expect.objectContaining({
          organization_id: "org-1",
          project_id: "proj-1",
        }),
      );
      expect(gtag).toHaveBeenCalledWith(
        "event",
        "open_dashboard",
        expect.objectContaining({
          organization_id: "org-1",
          project_id: "proj-1",
        }),
      );
    });
  });

  describe("given Reo is not yet available on mount", () => {
    it("calls Reo.identify once Reo appears", async () => {
      render(<SignedInExtraFooterComponents />);

      const identify = vi.fn();
      (window as any).Reo = { identify };
      await vi.advanceTimersByTimeAsync(250);

      expect(identify).toHaveBeenCalledWith({
        username: "user@example.com",
        type: "email",
        firstname: "Test User",
        company: "Acme",
      });
    });

    it("only identifies once even if Reo.identify is invoked again after a later poll tick", async () => {
      render(<SignedInExtraFooterComponents />);

      const identify = vi.fn();
      (window as any).Reo = { identify };
      await vi.advanceTimersByTimeAsync(250);
      await vi.advanceTimersByTimeAsync(250);

      expect(identify).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the user is impersonating", () => {
    it("never calls gtag even after gtag becomes available", async () => {
      vi.doMock("~/hooks/useRequiredSession", () => ({
        useRequiredSession: () => ({
          data: {
            user: {
              id: "user-1",
              email: "user@example.com",
              name: "Test User",
              impersonator: "admin-1",
            },
          },
        }),
      }));
      vi.resetModules();
      const { SignedInExtraFooterComponents: Impersonated } = await import(
        "../ExtraFooterComponents"
      );

      render(<Impersonated />);

      const gtag = vi.fn();
      (window as any).gtag = gtag;
      await vi.advanceTimersByTimeAsync(250);

      expect(gtag).not.toHaveBeenCalled();
    });
  });
});
