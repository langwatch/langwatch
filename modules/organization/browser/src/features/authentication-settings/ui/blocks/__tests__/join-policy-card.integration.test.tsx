/**
 * @vitest-environment jsdom
 * Who can join, and the plan that gates opening the door.
 * @see specs/identity/domain-auto-join.feature
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { DomainJoinSetting, JoinerRole } from "@langwatch/identity-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JoinPolicyCard } from "../join-policy-card.tsx";

afterEach(cleanup);

const CLOUD_LINK = { href: "/settings/subscription", label: "See plans" };

function renderCard({
  domainJoin = "off",
  joinDomains = [],
  joinerRole = "MEMBER" as JoinerRole,
  planLocked = false,
  planLink = CLOUD_LINK,
  ssoLive = false,
}: {
  domainJoin?: DomainJoinSetting;
  joinDomains?: string[];
  joinerRole?: JoinerRole;
  planLocked?: boolean;
  planLink?: { href: string; label: string };
  ssoLive?: boolean;
} = {}) {
  const onSave = vi.fn();
  render(
    <DesignSystemProvider forcedTheme="light">
      <JoinPolicyCard
        domainJoin={domainJoin}
        joinDomains={joinDomains}
        joinerRole={joinerRole}
        saving={false}
        planLocked={planLocked}
        planLink={planLink}
        ssoLive={ssoLive}
        onSave={onSave}
      />
    </DesignSystemProvider>,
  );
  return { onSave };
}

const option = (value: string): HTMLInputElement => {
  const input = screen.getByTestId(`join-policy-${value}`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`join-policy-${value} is not an input`);
  return input;
};

describe("given the who-can-join policy", () => {
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
    /** @scenario "Opening the door needs the plan that carries it" */
    it("shows both open settings, greyed, with the reason and a way to the plan", () => {
      renderCard({ planLocked: true });

      expect(option("request").disabled).toBe(true);
      expect(option("auto").disabled).toBe(true);
      expect(screen.getByTestId("join-policy-plan-badge")).toBeInTheDocument();
      expect(screen.getByTestId("join-policy-notice").textContent).toContain("Enterprise plan");
      expect(screen.getByRole("link", { name: "See plans" })).toBeInTheDocument();
    });

    /** @scenario "Closing the door is never refused for the plan" */
    it("never greys Invite only, so the door can always be shut", () => {
      renderCard({ planLocked: true, domainJoin: "auto", joinDomains: ["acme.com"] });

      expect(option("off").disabled).toBe(false);
    });

    /** @scenario "Closing the door is never refused for the plan" */
    it("leaves the setting already in force selectable", () => {
      renderCard({ planLocked: true, domainJoin: "request" });

      expect(option("request").disabled).toBe(false);
      expect(option("auto").disabled).toBe(true);
    });

    /** @scenario "Opening the door needs the plan that carries it" */
    it("does not offer to save an opening it would be refused for", () => {
      renderCard({ planLocked: true, domainJoin: "off" });

      fireEvent.click(screen.getByText("Approval required"));

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  describe("when the deployment is self-hosted", () => {
    it("sends the reader to a license rather than to a page they cannot buy from", () => {
      renderCard({
        planLocked: true,
        planLink: { href: "/settings/license", label: "Activate a license" },
      });

      expect(screen.getByRole("link", { name: "Activate a license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
    });
  });

  describe("when automatic joining is chosen", () => {
    /** @scenario "Turning it on names the domain and needs the domain proved" */
    it("says a named domain must be verified as yours first", () => {
      renderCard({ domainJoin: "auto", joinDomains: ["acme.com"] });

      expect(screen.getByTestId("join-policy-card").textContent).toContain(
        "must be verified by your organization",
      );
    });
  });

  describe("when a connection is routing sign-ins", () => {
    it("points at the identity provider door", () => {
      renderCard({ ssoLive: true });

      expect(screen.getByRole("link", { name: "Identity provider" })).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
    });
  });
});

describe("given the seat newcomers receive (ADR-171)", () => {
  describe("when the door is open", () => {
    /** @scenario The joiner seat setting lands email joiners as Developers */
    it("offers Member and Developer, and saves the seat with the door", async () => {
      const { onSave } = renderCard({ domainJoin: "request" });

      expect(screen.getByText("Seat for people who join")).toBeInTheDocument();
      // A real pointer sequence: the radio group listens to pointer events on the item.
      const user = userEvent.setup();
      await user.click(screen.getByText("Developer"));
      const save = screen.getByRole("button", { name: "Save" });
      expect(save.hasAttribute("disabled")).toBe(false);
      await user.click(save);

      expect(onSave).toHaveBeenCalledWith({
        domainJoin: "request",
        domains: [],
        joinerRole: "DEVELOPER",
      });
    });
  });

  describe("when the door is shut", () => {
    it("asks no seat question, because nobody can join", () => {
      renderCard({ domainJoin: "off" });

      expect(screen.queryByText("Seat for people who join")).toBeNull();
    });

    /** @scenario The joiner seat setting lands SSO joiners as Developers */
    it("still asks the seat question while a connection admits people", () => {
      renderCard({ domainJoin: "off", ssoLive: true });

      expect(screen.getByText("Seat for people who join")).toBeTruthy();
      expect(screen.getByTestId("joiner-seat-DEVELOPER")).toBeTruthy();
    });
  });

  describe("when the door is shut after a seat was picked", () => {
    /** @scenario Shutting the door leaves the joiner seat an administrator can no longer see untouched */
    it("leaves the seat out of the save instead of sending one it stopped showing", async () => {
      const { onSave } = renderCard({ domainJoin: "request" });
      const user = userEvent.setup();

      await user.click(screen.getByText("Developer"));
      await user.click(screen.getByText("Invite only"));
      expect(screen.queryByText("Seat for people who join")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0]?.[0]).toStrictEqual({ domainJoin: "off", domains: [] });
    });
  });
});
