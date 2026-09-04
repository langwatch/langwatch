/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TriggerAction } from "~/generated/prisma/client";
import { DeliveryPicker } from "../DeliveryPicker";

// Transitive: provider ConfigForms import ~/utils/api at module scope.
// DeliveryPicker itself never touches tRPC, so an empty shape suffices.
vi.mock("~/utils/api", () => ({
  api: { useUtils: () => ({}) },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderPicker = (
  props: Partial<Parameters<typeof DeliveryPicker>[0]> = {},
) =>
  render(
    <DeliveryPicker
      value={null}
      onChange={vi.fn()}
      source="trace"
      {...props}
    />,
    { wrapper: Wrapper },
  );

describe("DeliveryPicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders under the Delivery facet header", () => {
    renderPicker();

    expect(screen.getByText("Delivery")).toBeInTheDocument();
  });

  describe("given the draft source is customGraph", () => {
    it("does not render the action-category cards at all", () => {
      renderPicker({ source: "customGraph" });

      expect(
        screen.queryByRole("button", { name: /add to dataset/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /add to annotation queue/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/^Action$/)).not.toBeInTheDocument();
    });

    it("keeps the notify cards enabled", () => {
      renderPicker({ source: "customGraph" });

      expect(
        screen.getByRole("button", { name: /email/i }),
      ).not.toHaveAttribute("aria-disabled");
      expect(
        screen.getByRole("button", { name: /slack/i }),
      ).not.toHaveAttribute("aria-disabled");
    });
  });

  describe("given the draft source is trace", () => {
    describe("when an action card is clicked", () => {
      it("calls onChange with the picked action", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        renderPicker({ source: "trace", onChange });

        const dataset = screen.getByRole("button", {
          name: /add to dataset/i,
        });
        expect(dataset).not.toHaveAttribute("aria-disabled");
        await user.click(dataset);

        expect(onChange).toHaveBeenCalledWith(TriggerAction.ADD_TO_DATASET);
      });
    });
  });

  describe("given a trace automation", () => {
    /** @scenario "The webhook card appears among the notify channels" */
    it("offers the webhook card alongside email and Slack, ready to pick", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderPicker({ onChange });

      expect(
        screen.getByRole("button", { name: /email/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /slack/i }),
      ).toBeInTheDocument();
      // Slack's own description names a Slack webhook, so anchor on the label.
      const webhook = screen.getByRole("button", { name: /^Webhook/ });
      expect(webhook).not.toHaveAttribute("aria-disabled");

      await user.click(webhook);

      expect(onChange).toHaveBeenCalledWith(TriggerAction.SEND_WEBHOOK);
    });
  });

  describe("given a report draft", () => {
    it("does not offer the webhook card, which reports cannot deliver on", () => {
      renderPicker({ source: "report" });

      expect(
        screen.queryByRole("button", { name: /^Webhook/ }),
      ).not.toBeInTheDocument();
    });
  });
});
