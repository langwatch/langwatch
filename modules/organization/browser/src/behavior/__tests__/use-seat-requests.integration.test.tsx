/**
 * @vitest-environment jsdom
 * Approve decides between approving at once and adding a Stripe seat first.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import type { OpenSeatRequests, SeatRequest } from "@langwatch/organization-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithOrganizationHost } from "../../testing.tsx";
import { useSeatRequests } from "../use-seat-requests.ts";

const { calls, openSeats, state } = vi.hoisted(() => ({
  calls: [] as { path: string; input: unknown }[],
  openSeats: vi.fn(),
  state: {
    open: undefined as unknown,
    failing: new Set<string>(),
  },
}));

vi.mock("@langwatch/browser-host/lent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLentHooks: () => ({ openSeats }),
}));

vi.mock("../organization-api.ts", () => {
  const endpoint = (path: string) => ({
    useQuery: () => ({ data: path === "seatRequest.listOpen" ? state.open : undefined }),
    useMutation: () => ({
      mutateAsync: async (input: unknown) => {
        calls.push({ path, input });
        if (state.failing.has(path)) throw new Error(`${path} failed`);
        return {};
      },
    }),
    invalidate: async () => {
      calls.push({ path: `${path}:invalidate`, input: undefined });
    },
  });
  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;
  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

const ORG = "org-1";
const REQUEST: SeatRequest = {
  id: "seat-request-1",
  email: "held@acme.example",
  name: "Held Person",
  userId: "user-held",
  source: "pending",
  idpRefused: false,
  idpKind: null,
  openedAt: 0,
};

function openRequests(overrides: Partial<OpenSeatRequests>): OpenSeatRequests {
  return {
    requests: [REQUEST],
    seatFree: false,
    approvalPath: { kind: "upgrade_plan", url: "/settings/subscription" },
    ...overrides,
  };
}

function ApproveButton() {
  const { approve } = useSeatRequests({ organizationId: ORG, canView: true, canManage: true });
  return (
    <button type="button" onClick={() => approve(REQUEST)}>
      Approve
    </button>
  );
}

const approvals = () => calls.filter((call) => call.path === "seatRequest.approve");
const invalidations = () => calls.filter((call) => call.path.endsWith(":invalidate"));
const expansions = () => calls.filter((call) => call.path === "subscription.addTeamMemberOrEvents");

describe("useSeatRequests approve", () => {
  afterEach(() => {
    cleanup();
    calls.length = 0;
    openSeats.mockReset();
    state.failing.clear();
  });

  describe("when a full seat is free", () => {
    /** @scenario "Approve with a seat free approves at once" */
    it("approves without opening the seats upgrade", async () => {
      state.open = openRequests({
        seatFree: true,
        approvalPath: {
          kind: "stripe_seats",
          currentSeats: 5,
          newSeats: 6,
          planType: "GROWTH_SEAT_EUR_MONTHLY",
          seatPrice: null,
        },
      });
      renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await waitFor(() => expect(approvals()).toHaveLength(1));
      expect(approvals()[0]!.input).toEqual({ organizationId: ORG, seatRequestId: REQUEST.id });
      expect(openSeats).not.toHaveBeenCalled();
      expect(expansions()).toHaveLength(0);
    });
  });

  describe("when the organization pays per seat through Stripe", () => {
    const stripeSeats = () =>
      openRequests({
        approvalPath: {
          kind: "stripe_seats",
          currentSeats: 5,
          newSeats: 6,
          planType: "GROWTH_SEAT_EUR_MONTHLY",
          seatPrice: { amount: 29, currency: "EUR" },
        },
      });

    /** @scenario "Approve on a live Stripe seat subscription adds the seat, then approves" */
    it("adds the seat on confirm and only then approves", async () => {
      state.open = stripeSeats();
      renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      expect(approvals()).toHaveLength(0);
      expect(openSeats).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG, currentSeats: 5, newSeats: 6 }),
      );
      const { onConfirm } = openSeats.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
      await onConfirm();

      expect(
        calls.map((call) => call.path).filter((path) => !path.endsWith(":invalidate")),
      ).toEqual(["subscription.addTeamMemberOrEvents", "seatRequest.approve"]);
      expect(expansions()[0]!.input).toEqual({
        organizationId: ORG,
        plan: "GROWTH_SEAT_EUR_MONTHLY",
        upgradeMembers: true,
        upgradeTraces: false,
        totalMembers: 6,
        totalTraces: 0,
      });
    });

    /** @scenario "Approve on a live Stripe seat subscription adds the seat, then approves" */
    it("rereads the seat totals when the approval fails after the seat was bought", async () => {
      state.open = stripeSeats();
      state.failing.add("seatRequest.approve");
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));
      const { onConfirm } = openSeats.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
      await onConfirm();

      expect(expansions()).toHaveLength(1);
      expect(calls.map((call) => call.path)).toContain("seatRequest.listOpen:invalidate");
      expect(calls.map((call) => call.path)).toContain("licenseEnforcement.checkLimit:invalidate");
      expect(host.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't approve the seat request" }),
      ]);
    });

    /** @scenario "A failed seat expansion approves nothing" */
    it("shows an error and does not approve when adding the seat fails", async () => {
      state.open = stripeSeats();
      state.failing.add("subscription.addTeamMemberOrEvents");
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));
      const { onConfirm } = openSeats.mock.calls[0]![0] as { onConfirm: () => Promise<void> };
      await onConfirm();

      expect(expansions()).toHaveLength(1);
      expect(approvals()).toHaveLength(0);
      expect(invalidations()).toHaveLength(0);
      expect(host.failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't add the seat" }),
      ]);
    });
  });
});
