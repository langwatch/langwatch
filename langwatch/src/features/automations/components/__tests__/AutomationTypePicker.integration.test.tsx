/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationTypePicker } from "../AutomationTypePicker";
import { useAutomationStore } from "../../state/automationStore";

// Transitive: provider ConfigForms import ~/utils/api at module scope.
vi.mock("~/utils/api", () => ({
  api: { useContext: () => ({}) },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderPicker = () =>
  render(<AutomationTypePicker />, { wrapper: Wrapper });

describe("AutomationTypePicker", () => {
  beforeEach(() => {
    useAutomationStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  describe("given the three presets", () => {
    it("shows Automation, Alert, and Schedule — never a Trace data card", () => {
      renderPicker();

      expect(
        screen.getByRole("button", { name: /Automation/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Alert/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Schedule/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Trace data")).not.toBeInTheDocument();
    });
  });

  describe("when the Schedule preset is picked", () => {
    it("dispatches SET_SOURCE to report", async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.click(screen.getByRole("button", { name: /Schedule/i }));

      expect(useAutomationStore.getState().draft.source).toBe("report");
    });
  });

  describe("when the Alert preset is picked", () => {
    it("switches to customGraph and seeds the Warning severity", async () => {
      const user = userEvent.setup();
      renderPicker();

      await user.click(screen.getByRole("button", { name: /Alert/i }));

      const draft = useAutomationStore.getState().draft;
      expect(draft.source).toBe("customGraph");
      expect(draft.alertType).toBe("WARNING");
    });

    it("keeps an already-chosen severity when re-picked", async () => {
      const user = userEvent.setup();
      useAutomationStore.getState().hydrate({
        ...useAutomationStore.getState().draft,
        source: "trace",
        alertType: "CRITICAL",
      });
      renderPicker();

      await user.click(screen.getByRole("button", { name: /Alert/i }));

      expect(useAutomationStore.getState().draft.alertType).toBe("CRITICAL");
    });
  });

  describe("given the source is locked", () => {
    it("marks the unpicked cards inert", () => {
      render(<AutomationTypePicker sourceLocked />, { wrapper: Wrapper });

      // The active card (Automation, the default source) stays live; the
      // others render aria-disabled.
      expect(
        screen.getByRole("button", { name: /Schedule/i }),
      ).toHaveAttribute("aria-disabled", "true");
    });
  });
});
