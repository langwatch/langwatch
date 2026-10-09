/**
 * @vitest-environment jsdom
 * The organization form's way back to the team, once the offer was declined.
 * Spec: specs/identity/join-before-create.feature
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    lookup: { outcome: "none" } as unknown,
    offer: { outcome: "none" } as unknown,
    mine: [] as { joinRequestId: string; organizationId: string }[],
    invitations: [] as unknown[],
  },
  calls: { request: [] as unknown[], admit: [] as unknown[] },
}));

vi.mock("@langwatch/identity-client", () => {
  const recording = (into: unknown[]) => ({
    useMutation: () => ({
      mutate: (input: unknown) => into.push(input),
      isPending: false,
      isError: false,
    }),
  });
  const read = (value: () => unknown) => ({
    useQuery: () => ({ data: value(), isPending: false, isSuccess: true }),
  });
  const invalidating = { invalidate: () => {} };
  return {
    identityClient: {
      useUtils: () => ({
        identity: {
          joinRequests: { lookup: invalidating, mine: invalidating, offer: invalidating },
        },
      }),
      identity: {
        joinRequests: {
          lookup: read(() => state.lookup),
          offer: read(() => state.offer),
          mine: read(() => state.mine),
          request: recording(calls.request),
          admitAutomatically: recording(calls.admit),
        },
      },
    },
  };
});

vi.mock("../../../../../behavior/organization-api.ts", () => ({
  api: {
    useUtils: () => ({ organization: { getAll: { invalidate: () => {} } } }),
    invite: {
      pendingForMe: {
        useQuery: () => ({ data: state.invitations, isPending: false, isSuccess: true }),
      },
    },
  },
}));

vi.mock("../../../../../behavior/organization-feedback.ts", () => ({
  useShowErrorToast: () => () => {},
}));

import { renderWithOrganizationHost } from "../../../../../testing.tsx";
import { JoinInsteadAction } from "../join-instead-action.tsx";

const acme = { organizationId: "org_acme", name: "Acme", colleagueCount: 10 };
const labs = { organizationId: "org_labs", name: "Acme Labs", colleagueCount: 3 };

beforeEach(() => {
  state.lookup = { outcome: "ask", organizations: [acme] };
  state.offer = { outcome: "none" };
  state.mine = [];
  state.invitations = [];
  calls.request.length = 0;
  calls.admit.length = 0;
});

afterEach(cleanup);

describe("given somebody who declined the offer for their domain", () => {
  describe("when one organization is open to it", () => {
    /** @scenario "After declining, one colleague organization is offered as a quiet action" */
    it("offers joining it by name as a single quiet action", () => {
      renderWithOrganizationHost(<JoinInsteadAction />);

      expect(screen.getByRole("button", { name: "Join Acme instead" })).toBeInTheDocument();
      expect(screen.queryByTestId("join-instead-chooser")).not.toBeInTheDocument();
    });

    /** @scenario "Joining from the organization step runs the same request as the offer" */
    it("asks to join through the offer's own request, with where it was made from", () => {
      renderWithOrganizationHost(<JoinInsteadAction origin="cli" />);
      fireEvent.click(screen.getByRole("button", { name: "Join Acme instead" }));

      expect(calls.request).toEqual([{ organizationId: "org_acme", origin: "cli" }]);
      expect(calls.admit).toEqual([]);
    });

    /** @scenario "Joining from the organization step runs the same request as the offer" */
    it("walks through the automatic door where the organization opened one", () => {
      state.lookup = { outcome: "auto", organization: acme };

      renderWithOrganizationHost(<JoinInsteadAction />);
      fireEvent.click(screen.getByRole("button", { name: "Join Acme instead" }));

      expect(calls.admit).toEqual([{ origin: "web" }]);
      expect(calls.request).toEqual([]);
    });
  });

  describe("when several organizations are open to it", () => {
    /** @scenario "After declining, several colleague organizations are offered through a chooser" */
    it("lists each one to choose from and asks the one picked", () => {
      state.lookup = { outcome: "ask", organizations: [acme, labs] };

      renderWithOrganizationHost(<JoinInsteadAction />);
      expect(screen.queryByRole("button", { name: /Ask to join/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Join an existing organization" }));

      expect(screen.getByRole("button", { name: "Ask to join Acme" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Ask to join Acme Labs" }));
      expect(calls.request).toEqual([{ organizationId: "org_labs", origin: "web" }]);
    });
  });
});

describe("given the takeover still has something to say", () => {
  it("stays out of the way of an open offer, a wait or an invitation", () => {
    state.offer = { outcome: "ask", organizations: [acme] };
    renderWithOrganizationHost(<JoinInsteadAction />);
    expect(screen.queryByTestId("join-instead-action")).not.toBeInTheDocument();
    cleanup();

    state.offer = { outcome: "none" };
    state.mine = [{ joinRequestId: "jr_1", organizationId: "org_acme" }];
    renderWithOrganizationHost(<JoinInsteadAction />);
    expect(screen.queryByTestId("join-instead-action")).not.toBeInTheDocument();
    cleanup();

    state.mine = [];
    state.invitations = [{ inviteCode: "code_1" }];
    renderWithOrganizationHost(<JoinInsteadAction />);
    expect(screen.queryByTestId("join-instead-action")).not.toBeInTheDocument();
  });

  it("renders nothing when no organization is open to the domain", () => {
    state.lookup = { outcome: "none" };
    renderWithOrganizationHost(<JoinInsteadAction />);
    expect(screen.queryByTestId("join-instead-action")).not.toBeInTheDocument();
  });
});
