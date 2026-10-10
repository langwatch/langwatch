/**
 * @vitest-environment jsdom
 * Settings pages read at one measure, left-aligned under the title, forms and tables alike.
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
  describe("when it is a form, list or table page", () => {
    it.each([
      "/settings",
      "/settings/profile",
      "/settings/security",
      "/settings/checkup",
      "/settings/integrations",
      "/settings/api-keys",
      "/settings/audit-log",
      "/settings/model-providers",
    ])("frames %s at the one settings measure", (pathname) => {
      expect(measureAt({ pathname })).toBe("960px");
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

describe("wide tool pages", () => {
  it.each(["/ops/upgrades/runs/run_1", "/demo/analytics"])(
    "keeps %s in a bounded scroll container",
    (pathname) => {
      frameAt({ pathname });
      const body = screen.getByText("Page content").parentElement;
      expect(body).not.toBeNull();
      if (!body) return;
      const style = getComputedStyle(body);
      expect(style.overflowY).toBe("auto");
      expect(style.minHeight).toBe("0px");
      expect(style.display).toBe("flex");
    },
  );
});
