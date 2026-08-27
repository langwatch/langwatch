/**
 * @vitest-environment jsdom
 *
 * Who can join, and the plan that gates opening the door (D12).
 *
 * Spec: specs/identity/domain-auto-join.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { DomainJoinSetting } from "@langwatch/identity";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsEnterprise, mockIsSaaS } = vi.hoisted(() => ({
  mockIsEnterprise: { current: true },
  mockIsSaaS: { current: true },
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: mockIsEnterprise.current,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: mockIsSaaS.current } }),
}));

const { JoinPolicyCard } = await import("../JoinPolicyCard");

function renderCard({
  // Typed as the setting rather than inferred from the default: `"off" as
  // const` narrows the parameter to that one literal, so every scenario that
  // opens the door was passing a value the helper's own signature refused.
  domainJoin = "off",
  joinDomains = [] as string[],
}: {
  domainJoin?: DomainJoinSetting;
  joinDomains?: string[];
} = {}) {
  const onSave = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
      <JoinPolicyCard
        domainJoin={domainJoin}
        joinDomains={joinDomains}
        saving={false}
        onSave={onSave}
      />
    </ChakraProvider>,
  );
  return { onSave };
}

/** The radio's own input, which is what actually carries `disabled`. */
function option(value: string): HTMLInputElement {
  return screen.getByTestId(`join-policy-${value}`) as HTMLInputElement;
}

describe("given the who-can-join policy", () => {
  beforeEach(() => {
    mockIsEnterprise.current = true;
    mockIsSaaS.current = true;
  });
  afterEach(() => cleanup());

  describe("when the organization holds the Enterprise plan", () => {
    it("offers all three settings and no plan notice", () => {
      renderCard();

      expect(option("off").disabled).toBe(false);
      expect(option("request").disabled).toBe(false);
      expect(option("auto").disabled).toBe(false);
      expect(screen.queryByTestId("join-policy-plan-badge")).toBeNull();
    });
  });

  describe("when the organization's plan does not carry the control", () => {
    beforeEach(() => {
      mockIsEnterprise.current = false;
    });

    /** @scenario Opening the door needs the plan that carries it */
    it("shows both open settings, greyed, with the reason and a way to the plan", () => {
      renderCard();

      // Visible, not hidden: a control somebody cannot see is one they cannot
      // tell apart from a control that does not exist.
      expect(option("request")).toBeInTheDocument();
      expect(option("auto")).toBeInTheDocument();
      expect(option("request").disabled).toBe(true);
      expect(option("auto").disabled).toBe(true);
      expect(screen.getByTestId("join-policy-plan-badge")).toBeInTheDocument();
      expect(screen.getByTestId("join-policy-notice").textContent).toContain(
        "Enterprise plan",
      );
      expect(
        screen.getByRole("link", { name: "See plans" }),
      ).toBeInTheDocument();
    });

    /** @scenario Closing the door is never refused for the plan */
    it("never greys Nobody, so the door can always be shut", () => {
      renderCard({ domainJoin: "auto", joinDomains: ["acme.com"] });

      expect(option("off").disabled).toBe(false);
    });

    /** @scenario Closing the door is never refused for the plan */
    it("leaves the setting already in force selectable", () => {
      // The organization opened the door under a plan it has since left. The
      // setting is still in force, so the radio that names it must stay
      // reachable — greying it would strand the reader on a state they cannot
      // return to after glancing at another option.
      renderCard({ domainJoin: "request" });

      expect(option("request").disabled).toBe(false);
      expect(option("auto").disabled).toBe(true);
    });

    /** @scenario Opening the door needs the plan that carries it */
    it("does not offer to save an opening it would be refused for", () => {
      renderCard({ domainJoin: "off" });

      fireEvent.click(screen.getByText("They ask, you approve"));

      const save = screen.getByRole("button", { name: "Save" });
      expect(save.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("when the deployment is self-hosted", () => {
    beforeEach(() => {
      mockIsEnterprise.current = false;
      mockIsSaaS.current = false;
    });

    it("sends the reader to a license rather than to a page they cannot buy from", () => {
      renderCard();

      expect(
        screen.getByRole("link", { name: "Activate a license" }),
      ).toHaveAttribute("href", "/settings/license");
    });
  });

  describe("when automatic joining is chosen", () => {
    /** @scenario Turning it on names the domain and needs the domain proved */
    it("says a named domain must be verified as yours first", () => {
      renderCard({ domainJoin: "auto", joinDomains: ["acme.com"] });

      const card = screen.getByTestId("join-policy-card");
      // What opens this door is the verification ceremony, never a count of
      // who happens to receive mail on the domain. The card no longer sends
      // anybody to the Authentication page for it: it is ON that page now.
      expect(card.textContent).toContain("must be verified as yours");
    });
  });
});
