/**
 * @vitest-environment jsdom
 * The post-login offer on a dashboard: a pending request decides nothing until
 * the dashboard's own organization has resolved. Spec: specs/identity/join-requests.feature
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    mine: [] as { joinRequestId: string; organizationId: string }[],
    offer: { outcome: "none" } as unknown,
    invitations: { data: [] as unknown[], isPending: false, isSuccess: true, isError: false },
  },
  calls: {
    request: [] as unknown[],
    admit: [] as unknown[],
    accept: [] as unknown[],
  },
}));

vi.mock("@langwatch/identity-client", () => {
  const recording = (into: unknown[]) => ({
    useMutation: () => ({
      mutate: (input: unknown) => into.push(input),
      isPending: false,
      isError: false,
    }),
  });
  const idle = { useMutation: () => ({ mutate: () => {}, isPending: false, isError: false }) };
  const invalidating = { invalidate: () => {} };
  return {
    identityClient: {
      useUtils: () => ({ identity: { joinRequests: { mine: invalidating, offer: invalidating } } }),
      identity: {
        joinRequests: {
          offer: { useQuery: () => ({ data: state.offer, isPending: false }) },
          mine: { useQuery: () => ({ data: state.mine, isPending: false }) },
          dismissOffer: idle,
          request: recording(calls.request),
          admitAutomatically: recording(calls.admit),
        },
      },
    },
  };
});

vi.mock("../../../../../behavior/organization-api.ts", () => {
  const recording = (into: unknown[]) => ({
    useMutation: () => ({
      mutate: (input: unknown) => into.push(input),
      isPending: false,
      isError: false,
    }),
  });
  const invalidating = { invalidate: () => {} };
  return {
    api: {
      useUtils: () => ({
        invite: { pendingForMe: invalidating },
        organization: { getAll: invalidating },
      }),
      invite: {
        pendingForMe: { useQuery: () => state.invitations },
        acceptInvite: recording(calls.accept),
      },
    },
  };
});

vi.mock("../../../../../behavior/organization-feedback.ts", () => ({
  useShowErrorToast: () => () => {},
}));

import { renderWithOrganizationHost } from "../../../../../testing.tsx";
import { JoinYourTeamTakeover } from "../join-your-team-takeover.tsx";

const acme = { organizationId: "org_acme", name: "Acme", colleagues: 3 };
const invitation = { inviteCode: "code_1", organizationName: "Acme", role: "DEVELOPER" };

beforeEach(() => {
  state.mine = [];
  state.offer = { outcome: "none" };
  state.invitations = { data: [], isPending: false, isSuccess: true, isError: false };
  calls.request.length = 0;
  calls.admit.length = 0;
  calls.accept.length = 0;
});

afterEach(cleanup);

describe("given a person with a pending request to join an organization", () => {
  /** @scenario "A pending request for another organization does not take over a dashboard that is still loading" */
  it("decides nothing while the current organization has not resolved yet", () => {
    state.mine = [{ joinRequestId: "jr_other", organizationId: "org_other" }];

    renderWithOrganizationHost(
      <JoinYourTeamTakeover
        currentOrganizationId={undefined}
        fallback={<div data-testid="current-organization" />}
      />,
    );

    expect(screen.queryByTestId("join-team-waiting")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask to join/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("current-organization")).toBeInTheDocument();
  });

  /** @scenario "A pending request for another organization does not block the current organization" */
  it("shows the waiting screen once the current organization has resolved and the request is for it", () => {
    state.mine = [{ joinRequestId: "jr_1", organizationId: "org_current" }];

    renderWithOrganizationHost(
      <JoinYourTeamTakeover
        currentOrganizationId="org_current"
        fallback={<div data-testid="current-organization" />}
      />,
    );

    expect(screen.getByTestId("join-team-waiting")).toBeInTheDocument();
    expect(screen.queryByTestId("current-organization")).not.toBeInTheDocument();
  });

  /** @scenario A pending join request can be left by signing out */
  it("starts the sign-out flow from the waiting screen", () => {
    state.mine = [{ joinRequestId: "jr_1", organizationId: "org_current" }];

    const { host } = renderWithOrganizationHost(
      <JoinYourTeamTakeover currentOrganizationId="org_current" fallback={<div />} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(host.signedOut).toBe(true);
  });

  it("leaves the dashboard alone once it has resolved to a different organization", () => {
    state.mine = [{ joinRequestId: "jr_other", organizationId: "org_other" }];

    renderWithOrganizationHost(
      <JoinYourTeamTakeover
        currentOrganizationId="org_current"
        fallback={<div data-testid="current-organization" />}
      />,
    );

    expect(screen.queryByTestId("join-team-waiting")).not.toBeInTheDocument();
    expect(screen.getByTestId("current-organization")).toBeInTheDocument();
  });
});

describe("given the welcome screen and an invitation already waiting (ADR-171 v6)", () => {
  /** @scenario A pending invitation is offered before asking to join */
  it("leads with the invitation and offers no ask beside it", () => {
    state.offer = { outcome: "ask", organizations: [acme] };
    state.invitations = { ...state.invitations, data: [invitation] };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} />);

    expect(screen.getByTestId("join-team-invitation")).toBeInTheDocument();
    expect(screen.getByText(/with the Developer seat/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask to join/ })).not.toBeInTheDocument();
  });

  /** @scenario A pending invitation leads even while a request to join is open */
  it("leads with the invitation even over a request already waiting", () => {
    state.mine = [{ joinRequestId: "jr_1", organizationId: "org_acme" }];
    state.invitations = { ...state.invitations, data: [invitation] };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} />);

    expect(screen.getByTestId("join-team-invitation")).toBeInTheDocument();
    expect(screen.queryByTestId("join-team-waiting")).not.toBeInTheDocument();
  });

  /** @scenario Accepting the invitation from the welcome screen lands the invited seat */
  it("accepts through the invitation's own code", () => {
    state.invitations = { ...state.invitations, data: [invitation] };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Accept the invitation to Acme/ }));

    expect(calls.accept).toEqual([{ inviteCode: "code_1" }]);
  });

  /** @scenario The invitation can be set aside without accepting it */
  it("steps aside in one click, without raising the ask or opening the door", () => {
    state.offer = { outcome: "ask", organizations: [acme] };
    state.invitations = { ...state.invitations, data: [invitation] };

    renderWithOrganizationHost(
      <JoinYourTeamTakeover
        currentOrganizationId={null}
        dismissLabel="Create a new organization instead"
        fallback={<div data-testid="beneath" />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create a new organization instead" }));

    expect(screen.queryByTestId("join-team-invitation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask to join/ })).not.toBeInTheDocument();
    expect(calls.admit).toEqual([]);
  });

  it("is not shown on a dashboard, which has an organization in view", () => {
    state.invitations = { ...state.invitations, data: [invitation] };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId="org_current" />);

    expect(screen.queryByTestId("join-team-invitation")).not.toBeInTheDocument();
  });
});

describe("given the welcome screen when the invitation lookup failed", () => {
  /** @scenario A failed invitation lookup neither asks nor admits */
  it("neither offers the ask nor walks through an automatic door", () => {
    state.invitations = { data: [], isPending: false, isSuccess: false, isError: true };
    state.offer = { outcome: "ask", organizations: [acme] };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} />);
    expect(screen.queryByRole("button", { name: /Ask to join/ })).not.toBeInTheDocument();

    cleanup();
    state.offer = { outcome: "auto", organization: acme };
    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} />);
    expect(calls.admit).toEqual([]);
  });
});

describe("given the welcome screen and an automatic door", () => {
  /** @scenario The welcome screen honours an automatic door */
  it("admits once, carrying where the person came from", () => {
    state.offer = { outcome: "auto", organization: acme };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} origin="cli" />);

    expect(screen.getByTestId("join-team-admitting")).toBeInTheDocument();
    expect(calls.admit).toEqual([{ origin: "cli" }]);
  });
});

describe("given the welcome screen reached from the terminal", () => {
  /** @scenario A request made from the terminal lands as a Developer when approved */
  it("asks to join with the cli origin", () => {
    state.offer = { outcome: "ask", organizations: [acme] };

    renderWithOrganizationHost(<JoinYourTeamTakeover currentOrganizationId={null} origin="cli" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask to join Acme" }));

    expect(calls.request).toEqual([{ organizationId: "org_acme", origin: "cli" }]);
  });
});
