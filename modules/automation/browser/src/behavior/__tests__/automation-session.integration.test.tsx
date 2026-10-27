/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomationHostProvider } from "../../model/automation-host.ts";
import { fakeAutomationHost } from "../../testing.tsx";
import { useCloseAddressedDrawer } from "../automation-session.ts";

describe("given a drawer opened by address", () => {
  describe("when it is closed", () => {
    it("keeps the query and drops every drawer key", () => {
      const host = fakeAutomationHost({
        query: { tab: "list", "drawer.open": "viewAutomation", "drawer.automationId": "a1" },
      });

      renderHook(() => useCloseAddressedDrawer(), {
        wrapper: ({ children }) => (
          <AutomationHostProvider value={host}>{children}</AutomationHostProvider>
        ),
      }).result.current();

      expect(host.recording.queries).toEqual([{ next: { tab: "list" }, replace: false }]);
    });
  });
});
