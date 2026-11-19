/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/settings-shell-v2.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WithStubNavigationHost } from "../../testing.tsx";
import { useSettingsMenu } from "../use-settings-menu.ts";

function wrapperWithPlan(plan: { isEnterprise?: boolean; isLoading?: boolean }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WithStubNavigationHost readings={{ plan }}>{children}</WithStubNavigationHost>;
  };
}

describe("given a plan that has not answered yet", () => {
  /** @scenario "A still-loading plan hides the enterprise entries" */
  it("hides the enterprise entries", () => {
    const { result } = renderHook(() => useSettingsMenu(), {
      wrapper: wrapperWithPlan({ isLoading: true, isEnterprise: false }),
    });

    const hrefs = result.current.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain("/settings/roles");
  });
});

describe("given an Enterprise plan that has answered", () => {
  /** @scenario "A still-loading plan hides the enterprise entries" */
  it("shows the enterprise entries", () => {
    const { result } = renderHook(() => useSettingsMenu(), {
      wrapper: wrapperWithPlan({ isLoading: false, isEnterprise: true }),
    });

    const hrefs = result.current.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/settings/roles");
  });
});

describe("given a plan that answered as not Enterprise", () => {
  /** @scenario "A plan without Enterprise sees its entries locked" */
  it("offers the enterprise entries locked", () => {
    const { result } = renderHook(() => useSettingsMenu(), {
      wrapper: wrapperWithPlan({ isLoading: false, isEnterprise: false }),
    });

    const roles = result.current
      .flatMap((group) => group.items)
      .find((item) => item.href === "/settings/roles");
    expect(roles?.isLocked).toBe(true);
  });
});

describe("given the release_braids reading", () => {
  function braidsHrefsWith(reading: { enabled: boolean; isLoading: boolean }): string[] {
    const { result } = renderHook(() => useSettingsMenu(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <WithStubNavigationHost
          readings={{
            plan: { isLoading: false, isEnterprise: true },
            flags: { release_braids: reading },
          }}
        >
          {children}
        </WithStubNavigationHost>
      ),
    });
    return result.current
      .flatMap((group) => group.items.map((item) => item.href))
      .filter((href) => href.includes("braids"));
  }

  /** @scenario "The settings menu hides Braids while release_braids has not answered" */
  it("hides Braids while loading or off, and offers it once the flag answers on", () => {
    expect(braidsHrefsWith({ enabled: false, isLoading: true })).toEqual([]);
    expect(braidsHrefsWith({ enabled: true, isLoading: true })).toEqual([]);
    expect(braidsHrefsWith({ enabled: false, isLoading: false })).toEqual([]);
    expect(braidsHrefsWith({ enabled: true, isLoading: false })).toEqual(["/settings/braids"]);
  });
});
