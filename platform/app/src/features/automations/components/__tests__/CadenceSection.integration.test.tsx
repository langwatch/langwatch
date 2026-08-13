/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_DRAFT } from "../../logic/draftReducer";
import { useAutomationStore } from "../../state/automationStore";
import { CadenceSection } from "../CadenceSection";

// Transitive: the store pulls in provider clients, which import ~/utils/api.
vi.mock("~/utils/api", () => ({
  api: { useUtils: () => ({}) },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function selectContainingOption(optionName: RegExp): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const match = selects.find((select) =>
    within(select)
      .queryAllByRole("option")
      .some((option) => optionName.test(option.textContent ?? "")),
  );
  if (!match) throw new Error(`No select with option ${String(optionName)}`);
  return match;
}

const seed = (draft: Partial<typeof INITIAL_DRAFT>) =>
  useAutomationStore.getState().hydrate({ ...INITIAL_DRAFT, ...draft });

describe("CadenceSection", () => {
  beforeEach(() => {
    useAutomationStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  describe("given an alert draft", () => {
    beforeEach(() => {
      seed({
        source: "customGraph",
        customGraphId: "graph-1",
        graphAlert: {
          seriesName: "0/latency/p95",
          operator: "gt",
          threshold: 100,
          timePeriod: 60,
        },
      });
    });

    it("renders the threshold rule", () => {
      render(<CadenceSection />, { wrapper: Wrapper });

      expect(selectContainingOption(/greater than/i)).toBeInTheDocument();
      expect(selectContainingOption(/1 hour/i)).toBeInTheDocument();
      expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    });

    describe("when the threshold is edited", () => {
      it("commits the parsed number to the draft", async () => {
        const user = userEvent.setup();
        render(<CadenceSection />, { wrapper: Wrapper });

        const input = screen.getByRole("spinbutton");
        await user.clear(input);
        await user.type(input, "250");

        expect(useAutomationStore.getState().draft.graphAlert.threshold).toBe(
          250,
        );
      });
    });

    describe("when the operator is changed", () => {
      it("commits it to the draft", async () => {
        const user = userEvent.setup();
        render(<CadenceSection />, { wrapper: Wrapper });

        await user.selectOptions(
          selectContainingOption(/greater than/i),
          "Less than",
        );

        expect(useAutomationStore.getState().draft.graphAlert.operator).toBe(
          "lt",
        );
      });
    });
  });

  describe("given a report draft", () => {
    it("renders the friendly schedule picker, not a raw cron field", () => {
      seed({ source: "report" });
      render(<CadenceSection />, { wrapper: Wrapper });

      expect(selectContainingOption(/Weekly/i)).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText("0 9 * * 1"),
      ).not.toBeInTheDocument();
    });

    it("commits the cron schedule to the draft in advanced mode", async () => {
      const user = userEvent.setup();
      seed({ source: "report" });
      render(<CadenceSection isEdit />, { wrapper: Wrapper });

      await user.click(screen.getByLabelText(/Edit as a cron expression/i));
      const cron = screen.getByPlaceholderText("0 9 * * 1");
      await user.clear(cron);
      await user.type(cron, "0 7 * * *");

      expect(useAutomationStore.getState().draft.report.cron).toBe("0 7 * * *");
    });
  });

  describe("given a trace automation draft", () => {
    /** @scenario "The cadence section is shown for notification triggers" */
    it("asks how to receive messages and shows the settle window", () => {
      seed({ source: "trace", action: "SEND_EMAIL" });
      render(<CadenceSection />, { wrapper: Wrapper });

      expect(
        screen.getByText("How do you want to receive messages?"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /one message per matching trace/i }),
      ).toBeInTheDocument();
      expect(screen.getByText("Settle window")).toBeInTheDocument();
      // The settle wait is the answer to "why wasn't this instant?" — the
      // section must say so, not leave the author expecting instant delivery.
      expect(
        screen.getByText(/no new spans have arrived for this long/i),
      ).toBeInTheDocument();
    });

    /** @scenario "Cadence defaults to a 5-minute digest for new notifications" */
    it("pre-picks batches every 5 minutes", () => {
      seed({ source: "trace", action: "SEND_EMAIL" });
      render(<CadenceSection />, { wrapper: Wrapper });

      expect(screen.getByRole("radio", { name: /in batches/i })).toBeChecked();
      expect(selectContainingOption(/every 5 minutes/i)).toHaveValue(
        "5min_digest",
      );
    });

    it("commits a per-trace choice to the draft", async () => {
      const user = userEvent.setup();
      seed({ source: "trace", action: "SEND_EMAIL" });
      render(<CadenceSection />, { wrapper: Wrapper });

      await user.click(
        screen.getByRole("radio", { name: /one message per matching trace/i }),
      );

      expect(useAutomationStore.getState().draft.notificationCadence).toBe(
        "immediate",
      );
    });

    it("returns to the batch window the author had when they flip back", async () => {
      const user = userEvent.setup();
      seed({ source: "trace", action: "SEND_EMAIL" });
      render(<CadenceSection />, { wrapper: Wrapper });

      await user.selectOptions(
        selectContainingOption(/every hour/i),
        "hourly_digest",
      );
      await user.click(
        screen.getByRole("radio", { name: /one message per matching trace/i }),
      );
      await user.click(screen.getByRole("radio", { name: /in batches/i }));

      expect(useAutomationStore.getState().draft.notificationCadence).toBe(
        "hourly_digest",
      );
    });

    /** @scenario "The receive choice is not duplicated when the channel hosts it" */
    it("offers only the settle window when the channel hosts the chooser beside its templates", () => {
      seed({ source: "trace", action: "SEND_SLACK_MESSAGE" });
      render(<CadenceSection />, { wrapper: Wrapper });

      expect(
        screen.queryByText("How do you want to receive messages?"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Settle window")).toBeInTheDocument();
    });
  });
});
