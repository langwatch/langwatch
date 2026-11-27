/**
 * @vitest-environment jsdom
 * Seat requests beside join requests, answered the way the organization pays.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { SeatApprovalPath, SeatRequest } from "@langwatch/organization-contract";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeatRequestsTable } from "../seat-requests-table.tsx";

const lateRequest: SeatRequest = {
  id: "seatrequest_1",
  email: "late@acme.example",
  name: "Late Arrival",
  userId: "user_late",
  source: "pending",
  idpRefused: false,
  idpKind: null,
  openedAt: Date.UTC(2026, 10, 6, 9),
};

function renderTable({
  seatFree = false,
  approvalPath,
  requests = [lateRequest],
}: {
  seatFree?: boolean;
  approvalPath: SeatApprovalPath;
  requests?: SeatRequest[];
}) {
  const onApprove = vi.fn();
  const onDecline = vi.fn();
  render(
    <DesignSystemProvider forcedTheme="light">
      <SeatRequestsTable
        requests={requests}
        seatFree={seatFree}
        approvalPath={approvalPath}
        canManage
        answeringId={null}
        onApprove={onApprove}
        onDecline={onDecline}
      />
    </DesignSystemProvider>,
  );
  return { onApprove, onDecline };
}

const stripeSeats: SeatApprovalPath = {
  kind: "stripe_seats",
  currentSeats: 5,
  newSeats: 6,
  planType: "GROWTH_SEAT_EUR_MONTHLY",
  seatPrice: { amount: 29, currency: "EUR" },
};

describe("given an open seat request", () => {
  afterEach(() => cleanup());

  describe("when an administrator opens the Directory requests", () => {
    /** @scenario "Administrators see seat requests beside join requests" */
    it("lists the person with Approve and Decline", async () => {
      const { onApprove, onDecline } = renderTable({ approvalPath: stripeSeats });

      expect(screen.getByText("Late Arrival")).toBeInTheDocument();
      expect(screen.getByText("No access")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Approve" }));
      await userEvent.click(screen.getByRole("button", { name: "Decline" }));
      expect(onApprove).toHaveBeenCalledWith(lateRequest);
      expect(onDecline).toHaveBeenCalledWith(lateRequest);
    });
  });

  describe("when the organization is account managed and no seat is free", () => {
    it("offers to contact LangWatch instead of Approve", () => {
      renderTable({
        approvalPath: { kind: "contact_sales", url: "https://langwatch.ai/contact?seats=6" },
      });

      expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Contact LangWatch to increase your plan" }),
      ).toBeInTheDocument();
    });
  });

  describe("when a seat is already free", () => {
    it("approves directly whatever the plan", () => {
      renderTable({
        seatFree: true,
        approvalPath: { kind: "upgrade_plan", url: "/settings/subscription" },
      });

      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });
  });

  describe("when the identity provider also refused the person", () => {
    it("marks the request as refused by the identity provider", () => {
      renderTable({
        approvalPath: stripeSeats,
        requests: [{ ...lateRequest, source: "idp_refused", idpRefused: true, idpKind: "okta" }],
      });

      expect(screen.getByText("Refused by your identity provider")).toBeInTheDocument();
    });
  });
});
