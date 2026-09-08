/**
 * @vitest-environment jsdom
 *
 * What the Costs page says when the server DECLINED the read.
 *
 * The bug this suite pins down was reported from a first visit: an
 * organization that had configured nothing opened Costs and was met by two red
 * alerts telling it something had gone wrong. Nothing had. The plan gate
 * (`requireEnterprisePlan`) and the permission check both answer before a
 * single cost row is read, so there was no outage to report — the page was
 * behaving exactly as designed and blaming itself for it.
 *
 * Two claims here, and both are about not lying:
 *
 *   1. A REFUSAL IS NOT A FAILURE. "Something went wrong, try again in a
 *      moment" is false twice over when the answer was a decline: nothing
 *      went wrong, and trying again cannot help. The page names the actual
 *      cause instead, and the live plan is what tells "your plan does not
 *      include this" apart from "your role does not open this" — prose from
 *      the server is copy and cannot be asserted on.
 *   2. A REFUSAL IS A SETTLED ANSWER. It means this screen has nothing on it
 *      and will keep having nothing until somebody changes the account, so the
 *      invented panels fill it by default. That is the exact case sample mode
 *      exists for, and it was the one case that never reached it, because a
 *      declined read looked identical to a read still in flight.
 *
 * A genuine outage keeps its red alert and keeps sample mode off. We know what
 * a refusal means; we do not know what a 500 means, and the page must not
 * paper over the difference.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** tRPC's own code for the summary read: null when it answers cleanly. */
  summaryErrorCode: null as string | null,
  spendersErrorCode: null as string | null,
  isEnterprise: true,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: harness.isEnterprise,
    activePlan: undefined,
  }),
}));
vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));
vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/utils/api", () => {
  // Shaped the way tRPC hands a failure to a component: the code rides on
  // `error.data.code`, and the page reads that rather than the message.
  const failure = (code: string | null) =>
    code === null
      ? { isError: false, error: null }
      : { isError: true, error: { data: { code } } };

  // The activity reads are declined too — the same gate covers them — which is
  // what a real first visit looks like. Answering them cleanly here would
  // settle the sample decision on their own and hide the thing under test.
  const declined = () => ({
    useQuery: () => ({
      data: undefined,
      isLoading: false,
      ...failure(harness.summaryErrorCode),
    }),
  });
  return {
    api: {
      governanceCost: {
        summary: {
          useQuery: () => ({
            data: undefined,
            isLoading: false,
            ...failure(harness.summaryErrorCode),
          }),
        },
        spenders: {
          useQuery: () => ({
            data: undefined,
            refetch: () => undefined,
            ...failure(harness.spendersErrorCode),
          }),
        },
      },
      activityMonitor: {
        summary: declined(),
        spendByDepartment: declined(),
        spendByUser: declined(),
        spendOverTime: declined(),
      },
    },
  };
});

const { default: CostsPage } = await import("../costs");

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  harness.summaryErrorCode = "FORBIDDEN";
  harness.spendersErrorCode = "FORBIDDEN";
  harness.isEnterprise = true;
  // The section keeps ONE sample choice per sitting, in session storage, so a
  // test that presses the toggle would otherwise hand its answer to the next
  // one and every later test would open with samples already off.
  window.sessionStorage.clear();
});
afterEach(cleanup);

describe("Costs page, a read the server declined", () => {
  /** @scenario A declined read is never reported as something going wrong */
  it("says nothing went wrong when the read was refused", async () => {
    renderPage();

    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("cost-lanes-error")).not.toBeInTheDocument();
  });

  /** @scenario A declined read fills the screen with sample data by default */
  it("turns sample mode on without the reader asking", async () => {
    renderPage();

    // The exit is on screen, which is how we know sample mode is what is
    // being shown rather than an empty page that happens to have no alert.
    expect(
      screen.getByRole("button", { name: /hide sample data/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThan(0);
  });

  /** @scenario A declined read names the plan when the plan is what declined */
  it("names the plan for an organization below Enterprise", async () => {
    harness.isEnterprise = false;
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /hide sample data/i }),
    );

    expect(screen.getByTestId("cost-lanes-refused")).toHaveTextContent(
      /Enterprise plan/i,
    );
    expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
  });

  /** @scenario A declined read names the grant when the plan already covers it */
  it("names the missing grant for an Enterprise organization", async () => {
    harness.isEnterprise = true;
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: /hide sample data/i }),
    );

    const refused = screen.getByTestId("cost-lanes-refused");
    expect(refused).toHaveTextContent(/do not have access/i);
    expect(refused).not.toHaveTextContent(/Enterprise plan/i);
  });

  /** @scenario The spender panel states what it holds when its read is declined */
  it("does not offer Try again on a panel whose read was refused", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: /hide sample data/i }),
    );

    // "Try again" is advice that cannot work against a decline, so the panel
    // says what would fill it instead.
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Billed spend by API key")).toBeInTheDocument();
  });
});

describe("Costs page, a read that genuinely broke", () => {
  /** @scenario A failed read still reports the failure */
  it("keeps the error alert for a server fault", async () => {
    harness.summaryErrorCode = "INTERNAL_SERVER_ERROR";
    harness.spendersErrorCode = "INTERNAL_SERVER_ERROR";
    renderPage();

    expect(screen.getByTestId("cost-lanes-error")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-lanes-refused")).not.toBeInTheDocument();
  });

  /** @scenario A failed read does not turn sample mode on by itself */
  it("leaves sample mode off so the outage stays visible", async () => {
    harness.summaryErrorCode = "INTERNAL_SERVER_ERROR";
    harness.spendersErrorCode = "INTERNAL_SERVER_ERROR";
    renderPage();

    // Offered, not applied: we do not know what is behind a fault, so the page
    // does not decide on the reader's behalf that the screen is empty.
    expect(
      screen.getByRole("button", { name: /see sample data/i }),
    ).toBeInTheDocument();
  });
});
