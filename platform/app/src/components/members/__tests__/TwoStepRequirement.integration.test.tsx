/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem, Table } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecondFactorCell } from "../SecondFactorCell";
import { TwoStepRequirementCard } from "../TwoStepRequirementCard";
import type { MemberSecondFactor } from "../useTwoStepRequirement";

/**
 * The card reads the organization's plan itself, so the lock travels with it.
 * These two are the seams it reads through, and nothing else about the app is
 * needed to render it.
 */
const plan = { isEnterprise: true, isFree: false, isLoading: false };
const publicEnv = { data: { IS_SAAS: true } };

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => plan,
}));
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => publicEnv,
}));

/**
 * What an administrator sees in the members area: the requirement, who can
 * meet it, and what their identity provider is doing about it.
 *
 * The table here mirrors the column the members page renders — same cell,
 * same inputs — so what is asserted is the surface an administrator actually
 * reads rather than a component in isolation.
 */
function memberFactor({
  userId,
  satisfied,
  passkeyCount = 0,
}: {
  userId: string;
  satisfied: boolean;
  passkeyCount?: number;
}): MemberSecondFactor {
  return {
    userId,
    name: userId,
    email: `${userId}@acme.com`,
    accountEnrollmentEnabled: satisfied,
    passkeyCount,
    satisfaction: satisfied
      ? ({ satisfied: true, by: "account_enrollment" } as const)
      : ({ satisfied: false, by: "none" } as const),
  };
}

function MembersHarness({
  members,
  mfaRequired,
  connection = { connected: false, assertsSecondFactor: false },
  onChange = vi.fn(),
}: {
  members: MemberSecondFactor[];
  mfaRequired: boolean;
  connection?: { connected: boolean; assertsSecondFactor: boolean };
  onChange?: (mfaRequired: boolean) => void;
}) {
  const held = members.filter((member) => !member.satisfaction.satisfied);
  return (
    <ChakraProvider value={defaultSystem}>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Name</Table.ColumnHeader>
            <Table.ColumnHeader>Two-step verification</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
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
        heldCount={held.length}
        memberCount={members.length}
        connection={connection}
        saving={false}
        onChange={onChange}
      />
    </ChakraProvider>
  );
}

describe("the members area's two-step verification surface", () => {
  beforeEach(() => {
    plan.isEnterprise = true;
    plan.isFree = false;
    plan.isLoading = false;
    publicEnv.data.IS_SAAS = true;
  });

  afterEach(() => {
    cleanup();
  });

  describe("given acme requires two-step verification and some members have set one up", () => {
    describe("when ana opens the organization's member list", () => {
      /** @scenario An administrator can see who has not set one up yet */
      it("says for every member whether they can prove a second factor", () => {
        render(
          <MembersHarness
            mfaRequired
            members={[
              memberFactor({ userId: "ana", satisfied: true }),
              memberFactor({ userId: "sam", satisfied: false }),
              memberFactor({
                userId: "kim",
                satisfied: false,
                passkeyCount: 1,
              }),
            ]}
          />,
        );

        // Every row says something. A blank cell reads as "not loaded", and
        // an administrator cannot chase somebody they cannot tell apart from
        // a slow query.
        for (const userId of ["ana", "sam", "kim"]) {
          const row = screen.getByTestId(`row-${userId}`);
          expect(within(row).getByText(/set up/i)).toBeInTheDocument();
        }
        expect(
          within(screen.getByTestId("row-ana")).getByTestId(
            "second-factor-yes",
          ),
        ).toBeInTheDocument();
        expect(
          within(screen.getByTestId("row-sam")).getByTestId("second-factor-no"),
        ).toBeInTheDocument();
      });

      /** @scenario An administrator can see who has not set one up yet */
      it("says at a glance how many are still held", () => {
        render(
          <MembersHarness
            mfaRequired
            members={[
              memberFactor({ userId: "ana", satisfied: true }),
              memberFactor({ userId: "sam", satisfied: false }),
              memberFactor({ userId: "kim", satisfied: false }),
            ]}
          />,
        );

        expect(screen.getByTestId("two-step-held-count").textContent).toContain(
          "2 of 3 members",
        );
      });

      /** @scenario An administrator can see who has not set one up yet */
      it("exposes nobody's secret, codes or device", () => {
        const { container } = render(
          <MembersHarness
            mfaRequired
            members={[
              memberFactor({ userId: "ana", satisfied: true }),
              memberFactor({
                userId: "kim",
                satisfied: false,
                passkeyCount: 2,
              }),
            ]}
          />,
        );
        const words = container.textContent ?? "";

        // Which KIND of thing somebody holds is fair; what and where it is,
        // is a directory of what to steal.
        for (const leak of [
          "secret",
          "Secret",
          "backup code",
          "Backup code",
          "iPhone",
          "MacBook",
          "device name",
          "JBSWY",
        ]) {
          expect(words).not.toContain(leak);
        }
      });
    });
  });

  describe("given acme's members sign in through a connection that asserts no second factor", () => {
    describe("when ana opens the organization's access settings", () => {
      /** @scenario An administrator is told when their connection asserts nothing */
      it("says the connection is not asserting a second factor", () => {
        render(
          <MembersHarness
            mfaRequired
            members={[memberFactor({ userId: "sam", satisfied: false })]}
            connection={{ connected: true, assertsSecondFactor: false }}
          />,
        );

        const warning = screen.getByTestId("two-step-connection-warning");
        expect(warning.textContent).toMatch(
          /not telling us that a second factor was used/i,
        );
      });

      /** @scenario An administrator is told when their connection asserts nothing */
      it("says members are asked to set one up here until it does, and names configuring it at the provider as the alternative", () => {
        render(
          <MembersHarness
            mfaRequired
            members={[memberFactor({ userId: "sam", satisfied: false })]}
            connection={{ connected: true, assertsSecondFactor: false }}
          />,
        );

        const warning = screen.getByTestId("two-step-connection-warning");
        expect(warning.textContent).toMatch(/until it does/i);
        expect(warning.textContent).toMatch(
          /set two-step verification up here/i,
        );
        expect(warning.textContent).toMatch(
          /turn a second factor on at your identity provider/i,
        );
      });
    });
  });

  describe("given a connection that does assert a second factor", () => {
    /** @scenario An administrator is told when their connection asserts nothing */
    it("says nothing about it", () => {
      render(
        <MembersHarness
          mfaRequired
          members={[memberFactor({ userId: "sam", satisfied: true })]}
          connection={{ connected: true, assertsSecondFactor: true }}
        />,
      );

      expect(screen.queryByTestId("two-step-connection-warning")).toBeNull();
    });
  });

  describe("given acme is not on a plan that carries the requirement", () => {
    describe("when ana opens the organization's access settings", () => {
      /** @scenario The requirement is offered on every plan and locked without one */
      it("still shows the card rather than hiding a security control", () => {
        plan.isEnterprise = false;
        plan.isFree = true;
        render(
          <MembersHarness
            mfaRequired={false}
            members={[memberFactor({ userId: "sam", satisfied: false })]}
          />,
        );

        expect(
          screen.getByTestId("two-step-requirement-card"),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Require two-step verification/i),
        ).toBeInTheDocument();
      });

      /** @scenario The requirement is offered on every plan and locked without one */
      it("greys the switch out so it cannot be turned on", () => {
        plan.isEnterprise = false;
        plan.isFree = true;
        render(
          <MembersHarness
            mfaRequired={false}
            members={[memberFactor({ userId: "sam", satisfied: false })]}
          />,
        );

        expect(
          screen.getByTestId("two-step-requirement-switch"),
        ).toBeDisabled();
      });

      /** @scenario The requirement is offered on every plan and locked without one */
      it("says which plan it needs, and points at the plans", () => {
        plan.isEnterprise = false;
        plan.isFree = true;
        render(
          <MembersHarness
            mfaRequired={false}
            members={[memberFactor({ userId: "sam", satisfied: false })]}
          />,
        );

        const notice = screen.getByTestId("two-step-requirement-plan-notice");
        expect(notice.textContent).toMatch(/Enterprise plan/);
        // The count is the honest reason to want this, so the upsell never
        // reads as the only thing on the card.
        expect(notice.textContent).toMatch(/set it up on their own accounts/i);
        expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute(
          "href",
          "/settings/subscription",
        );
        expect(
          screen.getByTestId("two-step-requirement-plan-badge").textContent,
        ).toBe("Enterprise plan");
      });

      /** @scenario The requirement is offered on every plan and locked without one */
      it("sends a self-hosted operator to the licence page, not to plans they cannot buy", () => {
        plan.isEnterprise = false;
        plan.isFree = true;
        publicEnv.data.IS_SAAS = false;
        render(
          <MembersHarness
            mfaRequired={false}
            members={[memberFactor({ userId: "sam", satisfied: false })]}
          />,
        );

        expect(
          screen.getByRole("link", { name: "Activate a license" }),
        ).toHaveAttribute("href", "/settings/license");
      });

      /** @scenario The requirement is offered on every plan and locked without one */
      it("keeps saying how many members cannot prove a second factor", () => {
        plan.isEnterprise = false;
        plan.isFree = true;
        render(
          <MembersHarness
            mfaRequired={false}
            members={[
              memberFactor({ userId: "ana", satisfied: true }),
              memberFactor({ userId: "sam", satisfied: false }),
            ]}
          />,
        );

        expect(screen.getByTestId("two-step-held-count").textContent).toContain(
          "1 of 2 members",
        );
      });
    });

    describe("when the requirement was already on before the plan lapsed", () => {
      /** @scenario The requirement is offered on every plan and locked without one */
      it("leaves the switch usable so the held members can be released", () => {
        plan.isEnterprise = false;
        plan.isFree = true;
        render(
          <MembersHarness
            mfaRequired
            members={[memberFactor({ userId: "sam", satisfied: false })]}
          />,
        );

        // Turning it OFF is never the paid move. An administrator who could
        // not release their own members would have bought a lockout.
        expect(
          screen.getByTestId("two-step-requirement-switch"),
        ).not.toBeDisabled();
        expect(
          screen.getByTestId("two-step-requirement-plan-notice").textContent,
        ).toMatch(/turning it back on needs the Enterprise plan/i);
      });
    });
  });

  describe("given the plan has not been resolved yet", () => {
    /** @scenario The requirement is offered on every plan and locked without one */
    it("marks nothing as locked while it is still loading", () => {
      plan.isEnterprise = false;
      plan.isLoading = true;
      render(
        <MembersHarness
          mfaRequired={false}
          members={[memberFactor({ userId: "sam", satisfied: false })]}
        />,
      );

      // A lock badge that appears and then vanishes for an Enterprise
      // organization tells them something untrue about what they bought.
      expect(
        screen.queryByTestId("two-step-requirement-plan-badge"),
      ).toBeNull();
      expect(screen.getByTestId("two-step-requirement-switch")).toBeDisabled();
    });
  });
});
