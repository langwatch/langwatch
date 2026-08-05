/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { TriggerAction } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryPicker } from "../DeliveryPicker";

// Transitive: provider ConfigForms import ~/utils/api at module scope.
// DeliveryPicker itself never touches tRPC, so an empty shape suffices.
vi.mock("~/utils/api", () => ({
  api: { useContext: () => ({}) },
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
      webhookEnabled={false}
      preserveHiddenWebhook={false}
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

  describe("given webhook delivery is flag-hidden", () => {
    it("does not mention or offer webhooks for a new automation", () => {
      renderPicker({ webhookEnabled: false });

      expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /webhook/i }),
      ).not.toBeInTheDocument();
    });

    it("shows an existing webhook selection read-only with a clear notice", () => {
      renderPicker({
        value: TriggerAction.SEND_WEBHOOK,
        webhookEnabled: false,
        preserveHiddenWebhook: true,
      });

      expect(screen.getByRole("button", { name: /webhook/i })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByText(/saved setup is read-only/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /edit setup/i }),
      ).not.toBeInTheDocument();
    });
  });
});
