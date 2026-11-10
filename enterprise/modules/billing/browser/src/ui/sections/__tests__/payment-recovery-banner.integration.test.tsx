/**
 * @vitest-environment jsdom
 * The payment banner the shell draws above every page, against a mocked `billingApi`.
 * @see enterprise/modules/billing/specs/payment-recovery.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentRecoveryBanner } from "../payment-recovery-banner.tsx";

const { reader, recovery, leaveTo, payLink } = vi.hoisted(() => ({
  reader: { canPay: true },
  recovery: {
    state: "none" as "none" | "failing" | "paused",
    accessStopsAt: "2099-12-31T00:00:00Z" as string | null,
  },
  leaveTo: vi.fn(),
  payLink: vi.fn(),
}));

vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiHostServices: () => ({
    session: {
      hasOrganizationPermission: (permission: string) =>
        reader.canPay && permission === "subscription:manage",
    },
    feedback: { failed: vi.fn() },
  }),
}));
vi.mock("@langwatch/browser-host/navigation", () => ({ uiLeaveTo: leaveTo }));
vi.mock("../../../behavior/billing-api.ts", () => ({
  billingApi: {
    subscription: {
      paymentRecovery: { useQuery: () => ({ data: { state: recovery.state } }) },
      paymentRecoveryDetails: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled
            ? { state: recovery.state, accessStopsAt: recovery.accessStopsAt }
            : undefined,
        }),
      },
      paymentRecoveryPayLink: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: { organizationId: string },
            handlers: { onSuccess: (link: { url: string }) => void },
          ) => {
            payLink(input);
            handlers.onSuccess({ url: "https://invoice.stripe.test/i/acme" });
          },
        }),
      },
    },
  },
}));

const renderBanner = () =>
  render(<PaymentRecoveryBanner organizationId="org_acme" organizationName="ACME" />, {
    wrapper: ({ children }) => (
      <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
    ),
  });

beforeEach(() => {
  reader.canPay = true;
  recovery.state = "none";
  recovery.accessStopsAt = "2099-12-31T00:00:00Z";
  leaveTo.mockClear();
  payLink.mockClear();
});
afterEach(() => cleanup());

describe("PaymentRecoveryBanner", () => {
  describe("when the organization's payment failed", () => {
    /** @scenario "A member who can pay sees the payment failed banner" */
    it("tells a member who can pay the date to update the card by and opens the invoice page", () => {
      recovery.state = "failing";

      renderBanner();

      const banner = screen.getByTestId("payment-recovery-banner");
      expect(banner.textContent).toContain("Your payment failed.");
      expect(banner.textContent).toContain("31 December 2099");
      fireEvent.click(screen.getByRole("button", { name: "Update card" }));
      expect(payLink).toHaveBeenCalledWith({ organizationId: "org_acme" });
      expect(leaveTo).toHaveBeenCalledWith("https://invoice.stripe.test/i/acme");
    });

    /** @scenario "A plain member sees no banner before the move to the Free plan" */
    it("shows a plain member nothing", () => {
      recovery.state = "failing";
      reader.canPay = false;

      renderBanner();

      expect(screen.queryByTestId("payment-recovery-banner")).toBeNull();
    });
  });

  describe("when the organization is paused", () => {
    /** @scenario "An admin of a paused organization sees the paused notice with a pay button" */
    it("gives a member who can pay the Free plan notice and Pay now", () => {
      recovery.state = "paused";

      renderBanner();

      expect(screen.getByTestId("payment-recovery-banner").textContent).toContain(
        "You're on the Free plan now.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Pay now" }));
      expect(leaveTo).toHaveBeenCalledWith("https://invoice.stripe.test/i/acme");
    });

    /** @scenario "A plain member of a paused organization is told to ask an admin" */
    it("tells a plain member to ask an admin, with no button", () => {
      recovery.state = "paused";
      reader.canPay = false;

      renderBanner();

      expect(screen.getByTestId("payment-recovery-banner").textContent).toContain(
        "Traces over the limit aren't being saved. Ask an admin to update billing.",
      );
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  /** @scenario "Recovery clears the banner" */
  it("shows nothing once the invoice is paid", () => {
    recovery.state = "none";

    renderBanner();

    expect(screen.queryByTestId("payment-recovery-banner")).toBeNull();
  });
});
