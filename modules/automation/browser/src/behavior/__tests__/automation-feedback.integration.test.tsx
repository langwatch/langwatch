/**
 * @vitest-environment jsdom
 * A refusal to save reaches the host as a warning, never as a success (WEB-989).
 * @see specs/design-system/toast-stack.feature
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AutomationHostProvider } from "../../model/automation-host.ts";
import { fakeAutomationHost } from "../../testing.tsx";
import { useAutomationToaster } from "../automation-feedback.ts";

describe("given the automation toaster", () => {
  describe("when the drawer refuses a save with a warning", () => {
    it("reports a warning, not a success", () => {
      const host = fakeAutomationHost();
      const { result } = renderHook(() => useAutomationToaster(), {
        wrapper: ({ children }) => (
          <AutomationHostProvider value={host}>{children}</AutomationHostProvider>
        ),
      });

      result.current.create({ title: "To save, pick a delivery channel.", type: "warning" });
      result.current.create({ title: "Automation created", type: "success" });

      expect(host.recording.warnings).toEqual([{ title: "To save, pick a delivery channel." }]);
      expect(host.recording.successes).toEqual([{ title: "Automation created" }]);
    });
  });
});
