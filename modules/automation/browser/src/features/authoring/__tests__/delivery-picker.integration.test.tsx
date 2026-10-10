/**
 * @vitest-environment jsdom
 */
import { TriggerAction } from "@langwatch/automation-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import { DeliveryPicker } from "../ui/sections/delivery-picker.tsx";

// Transitive: provider ConfigForms import the api binding at module scope.
// DeliveryPicker itself never touches tRPC, so an empty shape suffices.
vi.mock("../../../behavior/automation-api.ts", () => ({
  api: { useUtils: () => ({}) },
}));

const renderPicker = ({
  hasEmailProvider = true,
  ...props
}: Partial<Parameters<typeof DeliveryPicker>[0]> & { hasEmailProvider?: boolean } = {}) =>
  renderWithAutomationHost(
    <DeliveryPicker value={null} onChange={vi.fn()} source="trace" {...props} />,
    { host: fakeAutomationHost({ hasEmailProvider }) },
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

      expect(screen.queryByRole("button", { name: /add to dataset/i })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /add to annotation queue/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/^Action$/)).not.toBeInTheDocument();
    });

    it("keeps the notify cards enabled", () => {
      renderPicker({ source: "customGraph" });

      expect(screen.getByRole("button", { name: /email/i })).not.toHaveAttribute("aria-disabled");
      expect(screen.getByRole("button", { name: /slack/i })).not.toHaveAttribute("aria-disabled");
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

      expect(screen.getByRole("button", { name: /email/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /slack/i })).toBeInTheDocument();
      // Slack's own description names a Slack webhook, so anchor on the label.
      const webhook = screen.getByRole("button", { name: /^Webhook/ });
      expect(webhook).not.toHaveAttribute("aria-disabled");

      await user.click(webhook);

      expect(onChange).toHaveBeenCalledWith(TriggerAction.SEND_WEBHOOK);
    });
  });

  describe("given a report draft", () => {
    /** @scenario "Report delivery options describe sending on a schedule" */
    it("describes Slack as posting the report on its schedule", () => {
      renderPicker({ source: "report" });

      const slack = screen.getByRole("button", { name: /^Slack/ });
      expect(slack).toHaveTextContent("Post the report to Slack on its schedule.");
      expect(slack).not.toHaveTextContent(/when a trace matches/);
    });

    it("does not offer the webhook card, which reports cannot deliver on", () => {
      renderPicker({ source: "report" });

      expect(screen.queryByRole("button", { name: /^Webhook/ })).not.toBeInTheDocument();
    });
  });

  describe("given the installation has no email provider", () => {
    /** @scenario "The email channel cannot be chosen when the installation cannot send email" */
    it("disables the email card and says why on hover", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderPicker({ hasEmailProvider: false, onChange });

      const email = screen.getByRole("button", { name: /^Email/ });
      expect(email).toHaveAttribute("aria-disabled", "true");

      await user.click(email);
      expect(onChange).not.toHaveBeenCalled();

      // The click's pointerdown closed the tooltip; leave and re-enter to reopen it.
      await user.unhover(email);
      await user.hover(email);
      await waitFor(() => {
        expect(
          screen.getByText("Email is not configured. Ask an admin to set up a mail provider."),
        ).toBeInTheDocument();
      });
    });

    it("keeps the other notify channels choosable", () => {
      renderPicker({ hasEmailProvider: false });

      expect(screen.getByRole("button", { name: /^Slack/ })).not.toHaveAttribute("aria-disabled");
    });
  });
});
