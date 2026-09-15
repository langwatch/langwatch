/**
 * @vitest-environment jsdom
 * The seat-update dialog's body, against a mocked `billingApi`.
 * @see specs/licensing/proration-preview.feature
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import type { UpgradeModalSeatsVariant } from "@langwatch/ui-host/upgrade-modal-store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeatProrationPreview } from "../seat-proration-preview.tsx";

const { previewQuery, showErrorToastMock } = vi.hoisted(() => ({
  previewQuery: vi.fn(),
  showErrorToastMock: vi.fn(),
}));

vi.mock("../../../../behavior/billing-api.ts", () => ({
  billingApi: {
    subscription: { previewProration: { useQuery: () => previewQuery() } },
  },
}));

vi.mock("@langwatch/ui-host/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/ui-host/errors")>()),
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
    <ChakraProvider value={defaultSystem}>
      <Dialog.Root open={true}>
        <Dialog.Content>
          <SeatProrationPreview variant={variant} open={true} onClose={onClose} />
        </Dialog.Content>
      </Dialog.Root>
    </ChakraProvider>,
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

    /** Confirming charges the proration on the spot, so the dialog has to say
     *  so — an unlabelled annual total next to a "Confirm" button reads as if
     *  nothing is taken until the next invoice.
     *  @scenario "Seats mode modal shows the amount charged immediately" */
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
    /** @scenario "Seats mode modal presents a seat reduction as a credit" */
    it("calls a negative amount a credit rather than something due", () => {
      previewQuery.mockReturnValue(
        quote({
          amountDueCents: -12_000,
          formattedAmountDue: "-€120",
          formattedRecurringTotal: "€1,600",
          billingInterval: "year",
        }),
      );

      renderPreview({ ...seatUpdate(), newSeats: 3 });

      expect(screen.getAllByText("Credit applied today").length).toBeGreaterThan(0);
      expect(screen.queryByText("Due today")).toBeNull();
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
