/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/sidebar-collapse-preference.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  useSidebarCollapsed,
} from "../useSidebarCollapsed";

/**
 * Media-query stub that actually evaluates min/max-width against a chosen
 * viewport width, so Chakra's useBreakpointValue resolves real breakpoints
 * instead of the setup file's always-false polyfill.
 */
function stubViewportWidth(widthPx: number) {
  window.matchMedia = (query: string): MediaQueryList => {
    let matches = true;
    const min = /min-width:\s*([\d.]+)(px|em|rem)/.exec(query);
    if (min?.[1] && min[2]) {
      const value = parseFloat(min[1]);
      const px = min[2] === "px" ? value : value * 16;
      matches &&= widthPx >= px;
    }
    const max = /max-width:\s*([\d.]+)(px|em|rem)/.exec(query);
    if (max?.[1] && max[2]) {
      const value = parseFloat(max[1]);
      const px = max[2] === "px" ? value : value * 16;
      matches &&= widthPx <= px;
    }
    if (!min && !max) matches = false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("useSidebarCollapsed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("given a desktop viewport", () => {
    beforeEach(() => {
      stubViewportWidth(1440);
    });

    it("starts expanded with no stored preference", async () => {
      const { result } = renderHook(() => useSidebarCollapsed(), { wrapper });

      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(false);
      });
      expect(result.current.canToggle).toBe(true);
    });

    it("keeps the page's compact default until the user chooses", async () => {
      const { result } = renderHook(
        () => useSidebarCollapsed({ pageDefaultsToCompact: true }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(true);
      });
    });

    it("applies an explicit choice over the page default", async () => {
      const { result } = renderHook(
        () => useSidebarCollapsed({ pageDefaultsToCompact: true }),
        { wrapper },
      );

      act(() => {
        result.current.setCollapsed(false);
      });

      await waitFor(() => {
        expect(result.current.isCollapsed).toBe(false);
      });
      expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("false");
    });

    it("remembers the collapsed choice across mounts", async () => {
      const first = renderHook(() => useSidebarCollapsed(), { wrapper });
      act(() => {
        first.result.current.setCollapsed(true);
      });
      first.unmount();

      const second = renderHook(() => useSidebarCollapsed(), { wrapper });
      await waitFor(() => {
        expect(second.result.current.isCollapsed).toBe(true);
      });
    });
  });

  describe("given a small viewport", () => {
    beforeEach(() => {
      stubViewportWidth(600);
    });

    it("is always collapsed and offers no toggle, even with a stored expanded preference", async () => {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "false");

      const { result } = renderHook(() => useSidebarCollapsed(), { wrapper });

      await waitFor(() => {
        expect(result.current.canToggle).toBe(false);
      });
      expect(result.current.isCollapsed).toBe(true);
    });
  });
});
