/**
 * @vitest-environment jsdom
 * The seat-update dialog, against a mocked `billingApi`.
 * @see specs/licensing/proration-preview.feature
 */
import "@testing-library/jest-dom/vitest";
import type * as errorsModule from "@langwatch/browser-host/errors";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { SeatProrationPreviewProps } from "@langwatch/enterprise-billing-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeatProrationPreview } from "../seat-proration-preview.tsx";

type UpgradeModalSeatsVariant = SeatProrationPreviewProps["variant"] & { mode: "seats" };

const { previewQuery, showErrorToastMock } = vi.hoisted(() => ({
  previewQuery: vi.fn(),
  showErrorToastMock: vi.fn(),
}));

vi.mock("../../../../behavior/billing-api.ts", () => ({
  billingApi: {
    subscription: { previewProration: { useQuery: () => previewQuery() } },
  },
}));

vi.mock("@langwatch/browser-host/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof errorsModule>()),
  showErrorToast: showErrorToastMock,
}));

const quote = (overrides: Record<string, unknown> = {}) => ({
  data: {
    amountDueCents: 4200,
    formattedAmountDue: "$42.00",
    formattedCreditApplied: null,
    formattedRecurringTotal: "$199.00",
    billingInterval: "month",
    quotedAt: 1_700_000_000_000,
    ...overrides,
  },
  isLoading: false,
  isError: false,
});

const seatUpdate = (
  onConfirm: UpgradeModalSeatsVariant["onConfirm"] = () => Promise.resolve(),
): UpgradeModalSeatsVariant => ({
  mode: "seats",
  organizationId: "org-1",
  currentSeats: 5,
  newSeats: 7,
  onConfirm,
});

const renderPreview = (variant: UpgradeModalSeatsVariant, onClose = vi.fn()) => {
  render(
    <DesignSystemProvider forcedTheme="light">
      <SeatProrationPreview variant={variant} open={true} onClose={onClose} />
    </DesignSystemProvider>,
  );
  return { onClose };
};

const confirmButton = () => {
  const buttons = screen.getAllByRole("button", { name: "Confirm & Update" });
  return buttons[buttons.length - 1]!;
};

const cancelButton = () => {
  const buttons = screen.getAllByRole("button", { name: "Cancel" });
  return buttons[buttons.length - 1]!;
};

describe("<SeatProrationPreview/>", () => {
  beforeEach(() => {
    previewQuery.mockReturnValue(quote());
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  describe("given a seat update from 5 to 7 seats", () => {
    /** @scenario "Seats mode modal shows the recurring total after a seat update" */
    it("shows both seat counts and what the plan will cost from now on", () => {
      renderPreview(seatUpdate());

      expect(screen.getAllByText("Confirm seat update").length).toBeGreaterThan(0);
      expect(screen.getAllByText("5").length).toBeGreaterThan(0);
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
      expect(screen.getAllByText("New billing amount").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\$199\.00/).length).toBeGreaterThan(0);
    });

    /**
     * Confirming charges the proration on the spot, so the dialog has to say so — an unlabelled
     * annual total next to a "Confirm" button reads as if nothing is taken until the next invoice.
     * @scenario "Seats mode modal shows the amount charged immediately"
     */
    it("names what is taken today and the period the recurring total covers", () => {
      previewQuery.mockReturnValue(
        quote({
          amountDueCents: 32_000,
          formattedAmountDue: "€320",
          formattedRecurringTotal: "€1,920",
          billingInterval: "year",
        }),
      );

      renderPreview(seatUpdate());

      expect(screen.getAllByText("Due today").length).toBeGreaterThan(0);
      expect(screen.getAllByText("€320").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/€1,920 per year/).length).toBeGreaterThan(0);
      expect(screen.queryByTestId("proration-vat-split")).not.toBeInTheDocument();
    });

    /** @scenario "Seats mode modal splits VAT out of the amount charged today" */
    it("charges the VAT-inclusive amount and splits the VAT out under it", () => {
      previewQuery.mockReturnValue(
        quote({
          amountDueCents: 2507,
          formattedAmountDue: "€25.07",
          taxCents: 435,
          formattedAmountDueExcludingTax: "€20.72",
          formattedTax: "€4.35",
          formattedRecurringTotal: "€58",
        }),
      );

      renderPreview(seatUpdate());

      expect(screen.getAllByText("€25.07").length).toBeGreaterThan(0);
      expect(screen.getAllByTestId("proration-vat-split")[0]).toHaveTextContent(
        "€20.72 + €4.35 VAT",
      );
      expect(screen.getAllByText("excl. VAT").length).toBeGreaterThan(0);
    });

    /** @scenario "Cancelling proration preview does nothing" */
    it("closes without confirming when Cancel is clicked", () => {
      const onConfirm = vi.fn(() => Promise.resolve());
      const { onClose } = renderPreview(seatUpdate(onConfirm));

      fireEvent.click(cancelButton());

      expect(onClose).toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("confirms at the price on screen and closes", async () => {
      const onConfirm = vi.fn(() => Promise.resolve());
      const { onClose } = renderPreview(seatUpdate(onConfirm));

      fireEvent.click(confirmButton());

      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(1_700_000_000_000));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(showErrorToastMock).not.toHaveBeenCalled();
    });

    it("keeps the dialog open and reports a confirm that fails", async () => {
      const onConfirm = vi.fn(() => Promise.reject(new Error("Payment declined")));
      const { onClose } = renderPreview(seatUpdate(onConfirm));

      fireEvent.click(confirmButton());

      await waitFor(() =>
        expect(showErrorToastMock).toHaveBeenCalledWith(
          expect.objectContaining({ fallbackTitle: "Couldn't update your seats" }),
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("given a seat update that lowers the seat count", () => {
    /** @scenario "Seats mode modal presents a seat reduction as applying from the next cycle" */
    it("charges nothing today and dates the new billing amount", () => {
      previewQuery.mockReturnValue(
        quote({
          amountDueCents: 0,
          formattedAmountDue: "€0",
          formattedRecurringTotal: "€87",
          billingInterval: "month",
          appliesAt: Date.UTC(2026, 11, 1),
          keptSeats: 5,
          formattedKeptRecurringTotal: "€145",
        }),
      );

      renderPreview({ ...seatUpdate(), newSeats: 3 });

      expect(screen.getAllByText("Due today").length).toBeGreaterThan(0);
      expect(screen.getAllByText("€0").length).toBeGreaterThan(0);
      expect(screen.getAllByText("New billing amount from 1 Dec").length).toBeGreaterThan(0);
    });
  });

  describe("when the price is still being fetched", () => {
    /** @scenario "Seats mode modal shows loading state while fetching preview" */
    it("shows a spinner and will not let the change be confirmed yet", () => {
      previewQuery.mockReturnValue({ data: undefined, isLoading: true, isError: false });

      renderPreview(seatUpdate());

      expect(screen.queryByText(/new billing amount/i)).toBeNull();
      expect(confirmButton()).toBeDisabled();
    });
  });

  describe("when the price cannot be fetched", () => {
    /** @scenario "Seats mode modal shows error state on preview failure" */
    it("says the preview failed and will not let the change be confirmed", () => {
      previewQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error("billing provider unreachable"),
      });

      renderPreview(seatUpdate());

      expect(screen.getAllByText(/Couldn't load the price preview/).length).toBeGreaterThan(0);
      expect(confirmButton()).toBeDisabled();
    });
  });
});
