/**
 * @vitest-environment jsdom
 *
 * "Acme is already here — join instead?" on the create-organization screen
 * (D12, epic Q17).
 *
 * The word that matters is SOFT. Somebody starting a second organization at a
 * company that already has one is doing something ordinary — a separate
 * business unit, a sandbox, a customer's workspace — so the only failure this
 * notice can have is standing in their way. Nothing here confirms, blocks or
 * disables anything.
 *
 * Spec: specs/identity/join-before-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { JoinLookupDecision } from "@langwatch/identity";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { JoinInsteadNotice } from "../JoinInsteadNotice";

const openToAcme: JoinLookupDecision = {
  outcome: "ask",
  organizations: [
    { organizationId: "org_acme", name: "Acme", colleagueCount: 10 },
  ],
};

const renderNotice = (lookup?: JoinLookupDecision) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <JoinInsteadNotice lookup={lookup} />
      <button type="button">Continue</button>
    </ChakraProvider>,
  );

afterEach(() => cleanup());

describe("given an existing user whose domain matches an organization", () => {
  describe("when they open the create-organization screen", () => {
    /** @scenario Creating an organization on a matching domain is nudged, never blocked */
    it("says the organization is already here and offers joining instead", () => {
      renderNotice(openToAcme);

      expect(screen.getByTestId("join-instead-notice")).toBeInTheDocument();
      expect(screen.getByText(/Acme/)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Join instead/ }),
      ).toHaveAttribute("href", "/auth/join");
    });

    /** @scenario Creating an organization on a matching domain is nudged, never blocked */
    it("leaves creating the organization available and unobstructed", () => {
      renderNotice(openToAcme);

      // A nudge, not a gate: nothing is disabled, nothing has to be
      // confirmed, and the words say so.
      const carryOn = screen.getByRole("button", { name: "Continue" });
      expect(carryOn).toBeEnabled();
      expect(
        screen.getByText(/carry on and create a new one/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("given a domain no organization is open to", () => {
  describe("when they open the create-organization screen", () => {
    it("renders nothing at all", () => {
      const { container } = renderNotice({ outcome: "none" });

      expect(container.querySelector("[data-testid]")).toBeNull();
    });

    it("renders nothing while the answer is still in flight", () => {
      const { container } = renderNotice(void 0);

      expect(container.querySelector("[data-testid]")).toBeNull();
    });
  });
});
