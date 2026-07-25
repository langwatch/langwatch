/** @vitest-environment jsdom */
/**
 * The card a plan limit renders as, and who gets the way out of it.
 *
 * What the user saw instead: "Creating scenario failed / Your access in this
 * project doesn't cover this action" — the access-denied copy, on a failure
 * whose code, message and meta all said the project was on the free plan with
 * three of three scenarios in use. The card sent them to check permissions they
 * had nothing wrong with.
 *
 * @see specs/langy/langy-cli-tool-envelope.feature
 *      "A plan limit is a decision, not a broken step"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const trackEvent = vi.fn();
let canManagePlan = true;

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
    hasOrgPermission: (permission: string) =>
      permission === "organization:manage" && canManagePlan,
  }),
}));

vi.mock("~/hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({
    url: "/settings/subscription",
    buttonLabel: "Upgrade plan",
    isSaaS: true,
    isLoading: false,
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("~/utils/tracking", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const { LangyToolActivity } = await import("../components/LangyToolActivity");
const { useLangyStore } = await import("../stores/langyStore");

const limitFailure = JSON.stringify({
  ok: false,
  error: {
    code: "resource_limit_exceeded",
    kind: "resource_limit_exceeded",
    message:
      "Free plan limit of 3 scenarios reached. To increase your limits, upgrade your plan at https://app.langwatch.ai/settings/subscription",
    httpStatus: 403,
    meta: { limitType: "scenarios", current: 3, max: 3 },
    isHandled: true,
  },
});

const turn = (): UIMessage =>
  ({
    id: "assistant-limit",
    role: "assistant",
    parts: [
      {
        type: "tool-bash",
        toolCallId: "call-1",
        state: "output-error",
        input: {
          command:
            "langwatch scenario create 'New scenario' --situation x --format json",
        },
        errorText: limitFailure,
      },
    ],
  }) as UIMessage;

const renderTurn = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangyToolActivity message={turn()} />
    </ChakraProvider>,
  );

describe("a tool call refused on a plan limit", () => {
  beforeEach(() => {
    push.mockClear();
    trackEvent.mockClear();
    canManagePlan = true;
  });

  it("says the plan ran out, not that the access did", () => {
    renderTurn();
    const card = screen.getByRole("alert");
    expect(card.textContent).toContain(
      "Your plan includes 3 scenarios, and all 3 are in use.",
    );
    expect(card.textContent).not.toContain(
      "Your access in this project doesn't cover this action.",
    );
  });

  it("never shows the platform's internal vocabulary", () => {
    renderTurn();
    const card = screen.getByRole("alert");
    expect(card.textContent).not.toContain("resource_limit_exceeded");
    expect(card.textContent).not.toContain("limitType");
  });

  describe("when the viewer can change the plan", () => {
    it("offers the upgrade as the card's action", () => {
      renderTurn();
      expect(
        screen.getByRole("button", { name: /upgrade plan/i }),
      ).toBeTruthy();
    });

    it("navigates in-app rather than reloading the page", () => {
      renderTurn();
      screen.getByRole("button", { name: /upgrade plan/i }).click();
      expect(push).toHaveBeenCalledWith("/settings/subscription");
    });

    it("reports the upgrade into the same funnel as every other prompt", () => {
      renderTurn();
      screen.getByRole("button", { name: /upgrade plan/i }).click();
      expect(trackEvent).toHaveBeenCalledWith("subscription_hook_click", {
        project_id: "project_1",
        hook: "scenarios_limit_reached",
      });
    });

    // The floating panel is a card OVER the page, and it lands on the upgrade
    // button of the page the CTA just sent you to.
    it("gets the floating panel out of the way of the page it opens", () => {
      useLangyStore.setState({ panelMode: "floating", isOpen: true });
      renderTurn();
      screen.getByRole("button", { name: /upgrade plan/i }).click();
      expect(useLangyStore.getState().isOpen).toBe(false);
    });

    it("leaves the docked panel open, since it covers nothing", () => {
      useLangyStore.setState({ panelMode: "sidebar", isOpen: true });
      renderTurn();
      screen.getByRole("button", { name: /upgrade plan/i }).click();
      expect(useLangyStore.getState().isOpen).toBe(true);
    });
  });

  describe("when the viewer cannot change the plan", () => {
    beforeEach(() => {
      canManagePlan = false;
    });

    it("offers no upgrade action they would be refused at", () => {
      renderTurn();
      expect(screen.queryByRole("button", { name: /upgrade plan/i })).toBeNull();
    });

    it("tells them who to ask", () => {
      renderTurn();
      expect(screen.getByRole("alert").textContent).toContain(
        "Ask whoever manages your organization's plan to raise the scenarios limit.",
      );
    });

    it("navigates nowhere on its own", () => {
      renderTurn();
      expect(push).not.toHaveBeenCalled();
    });
  });
});
