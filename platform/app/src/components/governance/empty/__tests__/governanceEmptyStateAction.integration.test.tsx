/**
 * @vitest-environment jsdom
 *
 * How heavily the shared empty state draws what it offers.
 *
 * The regression this catches is invisible to every other assertion about
 * these panes: the button is present, correctly labelled and does the right
 * thing, and is simply drawn in a treatment the product owner has rejected.
 *
 * Pinned against reference buttons of known variant rather than merely
 * asserted to differ from each other. "Different from the other one" is not
 * the rule and would not enforce it — the component once mapped its quieter
 * emphasis to a solid red, which is louder than what it was meant to be
 * quieter than, and a not-equal assertion passes happily through that. The
 * class name is compared rather than the emitted CSS because the claim is
 * about which house variant is in use, and two buttons of the same variant and
 * size carry the same generated class.
 *
 * Spec: specs/ai-governance/dashboard/governance-summary-strip.feature
 */
import { Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { Boxes } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { GovernanceEmptyState, GovernanceEmptyStateAction } from "../index";

afterEach(cleanup);

/**
 * The three treatments this rule is written against, rendered by the app's own
 * Button so the comparison is against the house and not against a copy of it.
 */
function ReferenceButtons() {
  return (
    <>
      <Button size="sm" colorPalette="orange">
        reference solid small
      </Button>
      <Button size="sm" variant="outline">
        reference outline small
      </Button>
      <Button size="sm" variant="ghost">
        reference ghost small
      </Button>
    </>
  );
}

function renderPane({ emphasis }: { emphasis?: "primary" | "secondary" }) {
  render(
    <ChakraProvider value={defaultSystem}>
      <ReferenceButtons />
      <GovernanceEmptyState
        testId="pane"
        icon={Boxes}
        headline="No applications yet"
        description="An application is the set of agents one team ships together."
        action={
          <GovernanceEmptyStateAction emphasis={emphasis}>
            Register agent
          </GovernanceEmptyStateAction>
        }
      />
    </ChakraProvider>,
  );

  return screen.getByRole("button", { name: "Register agent" });
}

describe("GovernanceEmptyStateAction", () => {
  describe("when the action creates something of the organization own", () => {
    /** @scenario "An empty pane action is drawn as the outline house button" */
    it("draws it as the outline house button rather than a solid fill", () => {
      const action = renderPane({ emphasis: "primary" });

      expect(action.className).toBe(
        screen.getByText("reference outline small").className,
      );
      expect(action.className).not.toBe(
        screen.getByText("reference solid small").className,
      );
    });
  });

  describe("when the action only changes what is shown", () => {
    /** @scenario "A quieter empty pane action is drawn quieter than the house button" */
    it("draws it ghost, quieter than the house button", () => {
      const quiet = renderPane({ emphasis: "secondary" });

      expect(quiet.className).toBe(
        screen.getByText("reference ghost small").className,
      );
      expect(quiet.className).not.toBe(
        screen.getByText("reference outline small").className,
      );
    });
  });

  describe("when no emphasis is passed at all", () => {
    // The default is load-bearing: a page that forgets to declare weight is
    // the case that produced the defect this rule exists for, so the untold
    // default lands on the house button rather than on anything louder.
    it("falls back to the house button", () => {
      const action = renderPane({ emphasis: undefined });

      expect(action.className).toBe(
        screen.getByText("reference outline small").className,
      );
    });
  });
});
