/**
 * @vitest-environment jsdom
 * The members area's two-step verification surface: the requirement card and
 * the per-member cell, from the same inputs the pages hand them.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import type { OrganizationMemberFactor } from "@langwatch/identity-contract";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SecondFactorCell } from "../../../../../ui/elements/second-factor-cell.tsx";
import { TwoStepRequirementCard } from "../two-step-requirement-card.tsx";

afterEach(cleanup);

function memberFactor({
  userId,
  satisfied,
  passkeyCount = 0,
}: {
  userId: string;
  satisfied: boolean;
  passkeyCount?: number;
}): OrganizationMemberFactor {
  return {
    userId,
    name: userId,
    email: `${userId}@acme.com`,
    accountEnrollmentEnabled: satisfied,
    passkeyCount,
    satisfaction: satisfied
      ? { satisfied: true, by: "account_enrollment" }
      : { satisfied: false, by: "none" },
  };
}

function renderSurface({
  members,
  mfaRequired,
  connection = { connected: false, assertsSecondFactor: false },
  canTurnOn = true,
  planLocked = false,
  onChange = vi.fn(),
}: {
  members: OrganizationMemberFactor[];
  mfaRequired: boolean;
  connection?: { connected: boolean; assertsSecondFactor: boolean };
  canTurnOn?: boolean;
  planLocked?: boolean;
  onChange?: (mfaRequired: boolean) => void;
}) {
  render(
    <ChakraProvider value={defaultSystem}>
      <Table.Root>
        <Table.Body>
          {members.map((member) => (
            <Table.Row key={member.userId} data-testid={`row-${member.userId}`}>
              <Table.Cell>{member.name}</Table.Cell>
              <Table.Cell>
                <SecondFactorCell member={member} mfaRequired={mfaRequired} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <TwoStepRequirementCard
        mfaRequired={mfaRequired}
        heldCount={members.filter((member) => !member.satisfaction.satisfied).length}
        memberCount={members.length}
        connection={connection}
        canTurnOn={canTurnOn}
        planLocked={planLocked}
        planLink={{ href: "/settings/subscription", label: "See plans" }}
        saving={false}
        onChange={onChange}
      />
    </ChakraProvider>,
  );
  return { onChange };
}

const switchInput = () => screen.getByTestId("two-step-requirement-switch");

describe("given acme requires two-step verification and some members have set one up", () => {
  describe("when ana opens the organization's member list", () => {
    /** @scenario "An administrator can see who has not set one up yet" */
    it("says for every member whether they can prove a second factor, and never names a device", () => {
      renderSurface({
        mfaRequired: true,
        members: [
          memberFactor({ userId: "ana", satisfied: true }),
          memberFactor({ userId: "bo", satisfied: false }),
          memberFactor({ userId: "cy", satisfied: false, passkeyCount: 1 }),
        ],
      });

      expect(
        within(screen.getByTestId("row-ana")).getByTestId("second-factor-yes"),
      ).toHaveTextContent("Set up");
      expect(
        within(screen.getByTestId("row-bo")).getByTestId("second-factor-no"),
      ).toHaveTextContent("Waiting to set up");
      expect(
        within(screen.getByTestId("row-cy")).getByTestId("second-factor-passkey"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("two-step-held-count")).toHaveTextContent(
        "2 of 3 members cannot prove a second factor yet and are being asked to set one up.",
      );
      expect(screen.queryByText(/@acme\.com/)).toBeNull();
    });
  });
});

describe("given acme signs in through a connection that asserts no second factor", () => {
  describe("when ana reads the requirement card", () => {
    /** @scenario "An administrator is told when their connection asserts nothing" */
    it("warns that members signing in through it are asked to set one up here", () => {
      renderSurface({
        mfaRequired: false,
        members: [memberFactor({ userId: "ana", satisfied: true })],
        connection: { connected: true, assertsSecondFactor: false },
      });

      expect(screen.getByTestId("two-step-connection-warning")).toBeInTheDocument();
    });

    it("says nothing once the connection confirms a second factor", () => {
      renderSurface({
        mfaRequired: false,
        members: [memberFactor({ userId: "ana", satisfied: true })],
        connection: { connected: true, assertsSecondFactor: true },
      });

      expect(screen.queryByTestId("two-step-connection-warning")).toBeNull();
    });
  });
});

describe("given acme is not on a plan that carries the requirement", () => {
  describe("when ana opens the organization's security settings", () => {
    /** @scenario "The requirement is offered on every plan and locked without one" */
    it("keeps the card on screen with the switch locked, the count, and the way to a plan", () => {
      renderSurface({
        mfaRequired: false,
        canTurnOn: false,
        planLocked: true,
        members: [memberFactor({ userId: "bo", satisfied: false })],
      });

      expect(screen.getByTestId("two-step-requirement-card")).toBeInTheDocument();
      expect(switchInput()).toBeDisabled();
      expect(screen.getByTestId("two-step-requirement-plan-badge")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute(
        "href",
        "/settings/subscription",
      );
      expect(screen.getByTestId("two-step-held-count")).toHaveTextContent(
        "1 of 1 members cannot prove a second factor yet and would be asked to set one up.",
      );
    });

    /** @scenario "The requirement is offered on every plan and locked without one" */
    it("still lets ana turn it off once it is on and the plan has lapsed", async () => {
      const { onChange } = renderSurface({
        mfaRequired: true,
        canTurnOn: false,
        planLocked: true,
        members: [memberFactor({ userId: "bo", satisfied: false })],
      });

      expect(switchInput()).not.toBeDisabled();
      await userEvent.click(switchInput());
      expect(onChange).toHaveBeenCalledWith(false);
    });
  });
});

describe("given acme is on the Enterprise plan", () => {
  describe("when ana turns the requirement on", () => {
    it("hands the change to the page with no plan notice in the way", async () => {
      const { onChange } = renderSurface({
        mfaRequired: false,
        members: [memberFactor({ userId: "ana", satisfied: true })],
      });

      expect(screen.queryByTestId("two-step-requirement-plan-notice")).toBeNull();
      expect(screen.getByTestId("two-step-held-count")).toHaveTextContent(
        "All 1 members can prove a second factor.",
      );
      await userEvent.click(switchInput());
      expect(onChange).toHaveBeenCalledWith(true);
    });
  });
});
