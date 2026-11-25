/**
 * @vitest-environment jsdom
 * The data retention picker in the Growth upgrade dialog.
 * @see specs/billing/retention-at-upgrade.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { Currency } from "@langwatch/enterprise-billing-contract";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RetentionEstimateState } from "../../../model/retention-choice.ts";
import { UpgradeSeatsDialog } from "../upgrade-seats-dialog.tsx";

function renderDialog({
  retentionEstimate = { status: "loading" },
  onContinue = vi.fn(),
}: {
  retentionEstimate?: RetentionEstimateState;
  onContinue?: (input: { seats: number; retentionDays: number }) => void;
} = {}) {
  render(
    <UpgradeSeatsDialog
      open
      onClose={vi.fn()}
      minimumSeats={2}
      price={{ seatCents: 2900, currency: Currency.EUR, periodSuffix: "/mo" }}
      retentionEstimate={retentionEstimate}
      onContinue={onContinue}
      isLoading={false}
    />,
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
      ),
    },
  );
}

async function pickRetention(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Data retention" }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

beforeAll(() => {
  // jsdom has no scrolling; the select scrolls its list when it opens.
  const element: { scrollTo?: unknown; scrollIntoView?: unknown } = Element.prototype;
  element.scrollTo ??= () => undefined;
  element.scrollIntoView ??= () => undefined;
});

afterEach(() => cleanup());

describe("<UpgradeSeatsDialog/> data retention", () => {
  describe("when the dialog opens", () => {
    /** @scenario "The dialog starts at 90 days, included in Growth" */
    it("starts at 90 days, included, and says it can change later", () => {
      renderDialog();

      expect(screen.getByRole("combobox", { name: "Data retention" })).toHaveTextContent("90 days");
      expect(screen.getByTestId("upgrade-retention-included")).toHaveTextContent(
        "Included in Growth",
      );
      expect(screen.getByTestId("upgrade-retention-change-note")).toHaveTextContent(
        "You can change the retention period anytime",
      );
    });
  });

  describe("when the dialog lays out its parts", () => {
    /** @scenario "The data retention comes after the price" */
    it("shows the seats, then the price and its lines, then the data retention", () => {
      renderDialog();

      const parts = [
        screen.getByTestId("upgrade-seats-stepper"),
        screen.getByTestId("upgrade-seats-total"),
        screen.getByText("200,000 events a month included. Lite members free."),
        screen.getByText("Invite people after checkout."),
        screen.getByRole("combobox", { name: "Data retention" }),
        screen.getByTestId("upgrade-retention-change-note"),
        screen.getByTestId("upgrade-retention-included"),
      ];
      parts.slice(1).forEach((later, index) => {
        const position = parts[index]!.compareDocumentPosition(later);
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
    });
  });

  describe("when a longer retention is picked", () => {
    it("shows the storage line with a loading estimate", async () => {
      renderDialog();

      await pickRetention("1 year");

      expect(screen.getByTestId("upgrade-retention-storage")).toHaveTextContent(
        "€3 per GB a month",
      );
      expect(screen.getByTestId("upgrade-retention-estimate-loading")).toBeInTheDocument();
    });

    it("keeps the checkout available when the storage read failed", async () => {
      renderDialog({ retentionEstimate: { status: "failed" } });

      await pickRetention("1 year");

      expect(screen.queryByTestId("upgrade-retention-estimate")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Continue to checkout" })).toBeEnabled();
    });
  });

  describe("when the buyer continues to checkout", () => {
    /** @scenario "The picked retention travels with the checkout" */
    it("passes the stored days of the picked option", async () => {
      const onContinue = vi.fn();
      renderDialog({ onContinue });

      await pickRetention("180 days");
      fireEvent.click(screen.getByRole("button", { name: "Continue to checkout" }));

      await waitFor(() =>
        expect(onContinue).toHaveBeenCalledWith({ seats: 2, retentionDays: 182 }),
      );
    });
  });
});
