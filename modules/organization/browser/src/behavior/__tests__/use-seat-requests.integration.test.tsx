/**
 * @vitest-environment jsdom
 * Approve decides between approving at once and buying the seat in the same click.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import type {
  OpenSeatRequests,
  SeatApprovalCompletion,
  SeatApprovalWithSeat,
  SeatRequest,
} from "@langwatch/organization-contract";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithOrganizationHost } from "../../testing.tsx";
import { useSeatRequests } from "../use-seat-requests.ts";

const { calls, openSeats, state } = vi.hoisted(() => ({
  calls: [] as { path: string; input: unknown }[],
  openSeats: vi.fn(),
  state: {
    open: undefined as unknown,
    failing: new Set<string>(),
    errors: {} as Record<string, unknown>,
    answers: {} as Record<string, unknown[]>,
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
        if (path in state.errors) throw state.errors[path];
        const queued = state.answers[path];
        return queued && queued.length > 1 ? queued.shift() : (queued?.[0] ?? {});
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
  email: "lena@acme.example",
  name: "Lena",
  userId: "user-lena",
  source: "requested",
  idpRefused: false,
  idpKind: null,
  reason: "run the workbench",
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

function answer(path: string, ...answers: (SeatApprovalWithSeat | SeatApprovalCompletion)[]) {
  state.answers[path] = answers;
}

function ApproveButton() {
  const { approve, waitingId } = useSeatRequests({
    organizationId: ORG,
    canView: true,
    canManage: true,
  });
  return (
    <>
      <button type="button" onClick={() => approve(REQUEST)}>
        Approve
      </button>
      {waitingId ? <p>Waiting on {waitingId}</p> : null}
    </>
  );
}

const named = (path: string) => calls.filter((call) => call.path === path);
const invalidations = () => calls.filter((call) => call.path.endsWith(":invalidate"));

describe("useSeatRequests approve", () => {
  let opened: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    opened = vi.spyOn(window, "open").mockImplementation(() => null);
  });
  afterEach(() => {
    cleanup();
    calls.length = 0;
    openSeats.mockReset();
    state.failing.clear();
    state.answers = {};
    state.errors = {};
    opened.mockRestore();
    vi.useRealTimers();
  });

  describe("when a full seat is free", () => {
    /** @scenario "Approve with a seat free approves at once" */
    it("approves without buying a seat", async () => {
      state.open = { ...stripeSeats(), seatFree: true };
      renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await waitFor(() => expect(named("seatRequest.approve")).toHaveLength(1));
      expect(named("seatRequest.approve")[0]!.input).toEqual({
        organizationId: ORG,
        seatRequestId: REQUEST.id,
      });
      expect(named("seatRequest.approveWithSeat")).toHaveLength(0);
      expect(openSeats).not.toHaveBeenCalled();
    });

    /** @scenario "The approval toast says what the approval did" */
    it("says the address was invited when the approval invited it", async () => {
      state.open = { ...openRequests({}), seatFree: true };
      state.answers["seatRequest.approve"] = [{ outcome: "invited" }];
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await waitFor(() =>
        expect(host.successes).toEqual([
          expect.objectContaining({ title: "Lena was invited as a full member" }),
        ]),
      );
    });
  });

  describe("when no seat is free on a live Stripe seat subscription", () => {
    /** @scenario "Approve in one click with no seat free adds the seat without a confirmation dialog" */
    it("approves with a seat in one click and says a seat was added", async () => {
      state.open = stripeSeats();
      answer("seatRequest.approveWithSeat", {
        status: "approved",
        outcome: "promoted",
        seatAdded: true,
      });
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await waitFor(() => expect(host.successes).toHaveLength(1));
      expect(openSeats).not.toHaveBeenCalled();
      expect(named("seatRequest.approve")).toHaveLength(0);
      expect(named("seatRequest.approveWithSeat")[0]!.input).toEqual({
        organizationId: ORG,
        seatRequestId: REQUEST.id,
      });
      expect(host.successes[0]).toEqual(
        expect.objectContaining({ title: "Lena has a full seat", description: "1 seat added." }),
      );
    });

    /** @scenario "Approve on a live Stripe seat subscription adds the seat, then approves" */
    it("rereads the seat totals once the seat was added and the request approved", async () => {
      state.open = stripeSeats();
      answer("seatRequest.approveWithSeat", {
        status: "approved",
        outcome: "promoted",
        seatAdded: true,
      });
      renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await waitFor(() =>
        expect(calls.map((call) => call.path)).toContain(
          "licenseEnforcement.checkLimit:invalidate",
        ),
      );
      expect(calls.map((call) => call.path)).toContain("seatRequest.listOpen:invalidate");
      // The Users page's Team Members count reads limits.getUsage.
      expect(calls.map((call) => call.path)).toContain("limits.getUsage:invalidate");
    });

    /** @scenario "A failed seat expansion approves nothing" */
    it("shows that the seat could not be added and says nothing was approved", async () => {
      state.open = stripeSeats();
      state.failing.add("seatRequest.approveWithSeat");
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await waitFor(() =>
        expect(host.failures).toEqual([
          expect.objectContaining({ fallbackTitle: "Couldn't add the seat" }),
        ]),
      );
      expect(named("seatRequest.approve")).toHaveLength(0);
      expect(host.successes).toHaveLength(0);
    });

    /** @scenario "Approve opens the Stripe page only when Stripe needs the customer, then approves once paid" */
    it("opens the Stripe page, waits on the payment, then approves once paid", async () => {
      state.open = stripeSeats();
      answer("seatRequest.approveWithSeat", {
        status: "payment_required",
        url: "https://invoice.stripe.example/i/1",
        paymentRef: "ref-1",
      });
      answer(
        "seatRequest.completeSeatApproval",
        { status: "waiting" },
        {
          status: "approved",
          outcome: "promoted",
        },
      );
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));

      await screen.findByText(`Waiting on ${REQUEST.id}`);
      expect(opened).toHaveBeenCalledWith(
        "https://invoice.stripe.example/i/1",
        "_blank",
        "noopener",
      );
      expect(host.successes).toHaveLength(0);

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(named("seatRequest.completeSeatApproval")).toHaveLength(1));
      expect(host.successes).toHaveLength(0);

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(host.successes).toHaveLength(1));
      expect(named("seatRequest.completeSeatApproval")[1]!.input).toEqual({
        organizationId: ORG,
        seatRequestId: REQUEST.id,
        paymentRef: "ref-1",
      });
      expect(host.successes[0]).toEqual(expect.objectContaining({ title: "Lena has a full seat" }));
      expect(screen.queryByText(`Waiting on ${REQUEST.id}`)).toBeNull();
    });

    /** @scenario "A return while the payment is still being asked about is not lost" */
    it("asks again once the ask in flight answers waiting, then approves", async () => {
      state.open = stripeSeats();
      answer("seatRequest.approveWithSeat", {
        status: "payment_required",
        url: "https://invoice.stripe.example/i/1",
        paymentRef: "ref-1",
      });
      let answerFirst: (value: SeatApprovalCompletion) => void = () => {};
      const first = new Promise<SeatApprovalCompletion>((resolve) => {
        answerFirst = resolve;
      });
      state.answers["seatRequest.completeSeatApproval"] = [
        first,
        { status: "approved", outcome: "promoted" },
      ];
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));
      await screen.findByText(`Waiting on ${REQUEST.id}`);

      act(() => {
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("focus"));
      });
      expect(named("seatRequest.completeSeatApproval")).toHaveLength(1);
      await act(async () => answerFirst({ status: "waiting" }));

      await waitFor(() => expect(host.successes).toHaveLength(1));
      expect(named("seatRequest.completeSeatApproval")).toHaveLength(2);
      expect(host.successes[0]).toEqual(expect.objectContaining({ title: "Lena has a full seat" }));
    });

    describe("when a second approval is pressed while the first waits on its payment", () => {
      it("refuses it, so the first approval is still finished once paid", async () => {
        const other: SeatRequest = { ...REQUEST, id: "seat-request-2", name: "Omar" };
        state.open = { ...stripeSeats(), requests: [REQUEST, other] };
        answer("seatRequest.approveWithSeat", {
          status: "payment_required",
          url: "https://invoice.stripe.example/i/1",
          paymentRef: "ref-1",
        });
        function TwoRequests() {
          const { approve, waitingId } = useSeatRequests({
            organizationId: ORG,
            canView: true,
            canManage: true,
          });
          return (
            <>
              <button type="button" onClick={() => approve(REQUEST)}>
                Approve first
              </button>
              <button type="button" onClick={() => approve(other)}>
                Approve second
              </button>
              {waitingId ? <p>Waiting on {waitingId}</p> : null}
            </>
          );
        }
        const { host } = renderWithOrganizationHost(<TwoRequests />);

        await userEvent.click(screen.getByText("Approve first"));
        await screen.findByText(`Waiting on ${REQUEST.id}`);
        await userEvent.click(screen.getByText("Approve second"));

        expect(named("seatRequest.approveWithSeat")).toHaveLength(1);
        expect(host.failures).toEqual([
          expect.objectContaining({ fallbackTitle: "Finish the seat payment for Lena first" }),
        ]);
        expect(screen.getByText(`Waiting on ${REQUEST.id}`)).toBeInTheDocument();
      });
    });

    /** @scenario "An approval waiting on its Stripe page stops waiting once the request is answered elsewhere" */
    it("stops waiting once the request was answered elsewhere, so other approvals can buy", async () => {
      state.open = stripeSeats();
      answer("seatRequest.approveWithSeat", {
        status: "payment_required",
        url: "https://invoice.stripe.example/i/1",
        paymentRef: "ref-1",
      });
      state.errors["seatRequest.completeSeatApproval"] = {
        data: { error: { code: "seat_request_not_found", httpStatus: 404 } },
      };
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));
      await screen.findByText(`Waiting on ${REQUEST.id}`);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => expect(screen.queryByText(`Waiting on ${REQUEST.id}`)).toBeNull());
      expect(host.failures).toEqual([
        expect.objectContaining({
          fallbackTitle: "The seat request from Lena was already answered",
        }),
      ]);
      expect(calls.map((call) => call.path)).toContain("seatRequest.listOpen:invalidate");
    });

    describe("when the admin switches organization before paying the first one's page", () => {
      it("still clears the approval once paid, so the other organization can buy", async () => {
        state.open = stripeSeats();
        answer("seatRequest.approveWithSeat", {
          status: "payment_required",
          url: "https://invoice.stripe.example/i/1",
          paymentRef: "ref-1",
        });
        answer("seatRequest.completeSeatApproval", { status: "approved", outcome: "promoted" });
        function Switching() {
          const [organizationId, setOrganizationId] = useState(ORG);
          const { approve, waitingId } = useSeatRequests({
            organizationId,
            canView: true,
            canManage: true,
          });
          return (
            <>
              <button type="button" onClick={() => approve(REQUEST)}>
                Approve
              </button>
              <button type="button" onClick={() => setOrganizationId("org-2")}>
                Switch
              </button>
              {waitingId ? <p>Waiting on {waitingId}</p> : null}
            </>
          );
        }
        const { host } = renderWithOrganizationHost(<Switching />);
        await userEvent.click(screen.getByText("Approve"));
        await screen.findByText(`Waiting on ${REQUEST.id}`);

        await userEvent.click(screen.getByText("Switch"));
        expect(screen.queryByText(`Waiting on ${REQUEST.id}`)).toBeNull();
        act(() => {
          window.dispatchEvent(new Event("focus"));
        });

        await waitFor(() => expect(host.successes).toHaveLength(1));
        expect(named("seatRequest.completeSeatApproval")[0]!.input).toMatchObject({
          organizationId: ORG,
        });
        await userEvent.click(screen.getByText("Approve"));
        expect(named("seatRequest.approveWithSeat")).toHaveLength(2);
        expect(named("seatRequest.approveWithSeat")[1]!.input).toMatchObject({
          organizationId: "org-2",
        });
      });
    });

    it("says the seat payment was not completed when the Stripe page ended unpaid", async () => {
      state.open = stripeSeats();
      answer("seatRequest.approveWithSeat", {
        status: "payment_required",
        url: "https://invoice.stripe.example/i/1",
        paymentRef: "ref-1",
      });
      answer("seatRequest.completeSeatApproval", { status: "failed" });
      const { host } = renderWithOrganizationHost(<ApproveButton />);

      await userEvent.click(screen.getByText("Approve"));
      await screen.findByText(`Waiting on ${REQUEST.id}`);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() =>
        expect(host.failures).toEqual([
          expect.objectContaining({ fallbackTitle: "The seat payment was not completed" }),
        ]),
      );
      expect(host.successes).toHaveLength(0);
      expect(invalidations().length).toBeGreaterThan(0);
    });
  });
});
