/**
 * @vitest-environment jsdom
 * Settings form pages read at one narrow measure; list and table pages at the wider one.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ShellPageBody } from "../shell-page-body.tsx";

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    limits: { getUsage: { useQuery: () => ({ data: undefined }) } },
    user: { getSsoStatus: { useQuery: () => ({ data: undefined }) } },
    governance: {
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

afterEach(() => cleanup());

function frameAt({ pathname }: { pathname: string }): DOMStringMap {
  renderWithDesignSystem(
    <WithStubNavigationHost readings={{ pathname, currentUserId: "user_1", isLoading: true }}>
      <ShellPageBody>
        <p>Page content</p>
      </ShellPageBody>
    </WithStubNavigationHost>,
  );
  return screen.getByText("Page content").parentElement?.dataset ?? {};
}

function measureAt({ pathname }: { pathname: string }): string {
  return frameAt({ pathname }).pageMeasure ?? "";
}

describe("given a settings page", () => {
  describe("when it is a form page", () => {
    it.each([
      "/settings",
      "/settings/profile",
      "/settings/security",
      "/settings/checkup",
      "/settings/data-privacy",
      "/settings/license",
      "/settings/connect",
      "/settings/integrations",
    ])("frames %s at the form measure", (pathname) => {
      expect(measureAt({ pathname })).toBe("820px");
    });
  });

  describe("when it is your own account page", () => {
    it.each(["/settings/profile", "/settings/security"])("aligns %s to the left", (pathname) => {
      expect(frameAt({ pathname }).pageAlign).toBe("start");
    });

    it("centres the organization's settings", () => {
      expect(frameAt({ pathname: "/settings" }).pageAlign).toBe("center");
    });
  });

  describe("when it is a list or table page", () => {
    it.each([
      "/settings/api-keys",
      "/settings/secrets",
      "/settings/data-retention",
      "/settings/audit-log",
      "/settings/subscription",
      "/settings/model-providers",
    ])("frames %s at the table measure", (pathname) => {
      expect(measureAt({ pathname })).toBe("1280px");
    });
  });

  describe("when it is the authentication family", () => {
    it.each(["/settings/authentication", "/settings/authentication/provider"])(
      "leaves %s unmeasured, so its section rail fills the card",
      (pathname) => {
        expect(measureAt({ pathname })).toBe("");
      },
    );
  });
});
