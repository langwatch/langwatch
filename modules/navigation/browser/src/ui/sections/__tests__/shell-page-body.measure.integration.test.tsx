/**
 * @vitest-environment jsdom
 * Settings form pages read at one narrow measure; list and table pages at the wider one.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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

function measureAt({ pathname }: { pathname: string }): string {
  render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost readings={{ pathname, currentUserId: "user_1", isLoading: true }}>
        <ShellPageBody>
          <p>Page content</p>
        </ShellPageBody>
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
  return screen.getByText("Page content").parentElement?.dataset.pageMeasure ?? "";
}

describe("given a settings page", () => {
  describe("when it is a form page", () => {
    it.each(["/settings", "/settings/profile", "/settings/security", "/settings/checkup"])(
      "frames %s at the form measure",
      (pathname) => {
        expect(measureAt({ pathname })).toBe("820px");
      },
    );
  });

  describe("when it is a list or table page", () => {
    it.each(["/settings/api-keys", "/settings/secrets", "/settings/data-retention"])(
      "frames %s at the table measure",
      (pathname) => {
        expect(measureAt({ pathname })).toBe("1280px");
      },
    );
  });

  describe("when it is the authentication family", () => {
    it("fills the card", () => {
      expect(measureAt({ pathname: "/settings/authentication/provider" })).toBe("100%");
    });
  });
});
