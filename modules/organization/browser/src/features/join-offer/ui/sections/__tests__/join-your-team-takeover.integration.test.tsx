/**
 * @vitest-environment jsdom
 * The post-login offer on a dashboard: a pending request decides nothing until
 * the dashboard's own organization has resolved. Spec: specs/identity/join-requests.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { mine: [] as { joinRequestId: string; organizationId: string }[] },
}));

vi.mock("../../../../../behavior/organization-api.ts", () => {
  const idle = { useMutation: () => ({ mutate: () => {}, isPending: false }) };
  return {
    api: {
      useUtils: () => ({
        joinRequests: { mine: { invalidate: () => {} }, offer: { invalidate: () => {} } },
      }),
      joinRequests: {
        offer: { useQuery: () => ({ data: { outcome: "none" }, isPending: false }) },
        mine: { useQuery: () => ({ data: state.mine, isPending: false }) },
        dismissOffer: idle,
        request: idle,
      },
    },
  };
});

vi.mock("../../../../../behavior/organization-feedback.ts", () => ({
  useShowErrorToast: () => () => {},
}));

import { renderWithOrganizationHost } from "../../../../../testing.tsx";
import { JoinYourTeamTakeover } from "../join-your-team-takeover.tsx";

beforeEach(() => {
  state.mine = [];
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
