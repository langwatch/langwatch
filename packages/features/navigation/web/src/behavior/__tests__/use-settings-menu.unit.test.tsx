/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/settings-shell-v2.feature
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSettingsMenu } from "../use-settings-menu";
import { WithStubNavigationHost } from "../../testing";

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
    expect(hrefs).not.toContain("/settings/groups");
    expect(hrefs).not.toContain("/settings/scim");
  });
});

describe("given an Enterprise plan that has answered", () => {
  /** @scenario "A still-loading plan hides the enterprise entries" */
  it("shows the enterprise entries", () => {
    const { result } = renderHook(() => useSettingsMenu(), {
      wrapper: wrapperWithPlan({ isLoading: false, isEnterprise: true }),
    });

    const hrefs = result.current.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/settings/groups");
  });
});

describe("given a plan that answered as not Enterprise", () => {
  /** @scenario "A still-loading plan hides the enterprise entries" */
  it("hides the enterprise entries", () => {
    const { result } = renderHook(() => useSettingsMenu(), {
      wrapper: wrapperWithPlan({ isLoading: false, isEnterprise: false }),
    });

    const hrefs = result.current.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain("/settings/groups");
  });
});
