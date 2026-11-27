/**
 * The join-before-create card holds its shape whatever the domain sends: a long
 * name gives way before its colleague count does, and a long list scrolls inside
 * the card instead of growing it. Real layout, which jsdom cannot measure.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { JoinLookupDecision } from "@langwatch/identity-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
// Not `vitest/browser`: its matcher types win over jest-dom's in this package's typecheck and
// reject the RegExp text matchers its jsdom tests use. The lane's default viewport is phone width.

import { JoinBeforeCreateInterstitial } from "../join-before-create-interstitial.tsx";

const LONG_NAME = "Acme Applied Machine Learning Infrastructure and Evaluation Working Group EMEA";

afterEach(() => cleanup());

function renderStep(lookup: JoinLookupDecision) {
  renderWithDesignSystem(
    <JoinBeforeCreateInterstitial
      verifiedEmail="sam@acme.test"
      lookup={lookup}
      onCreateWorkspace={() => undefined}
      onJoinOrganization={() => undefined}
    />,
  );
}

function card(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-auth-card]");
  if (!element) throw new Error("the auth card did not render");
  return element;
}

describe("the join-before-create card", () => {
  describe("given a leading organization with a long name", () => {
    /** @scenario Sign-up offers the team before offering a workspace */
    it("truncates the name inside the card and keeps the count in view", async () => {
      renderStep({
        outcome: "ask",
        organizations: [{ organizationId: "org_long", name: LONG_NAME, colleagueCount: 20 }],
      });

      const join = await screen.findByRole("button", {
        name: `Join ${LONG_NAME} (20+ colleagues)`,
      });
      const name = join.querySelector<HTMLElement>(`[title="${LONG_NAME}"]`);
      const count = screen.getByText("(20+ colleagues)");
      if (!name) throw new Error("the leading name has no title to show it in full");

      await expect.poll(() => name.scrollWidth > name.clientWidth).toBe(true);
      expect(join.getBoundingClientRect().right).toBeLessThanOrEqual(
        card().getBoundingClientRect().right,
      );
      // The count is never the part that gives way.
      expect(count.scrollWidth).toBeLessThanOrEqual(count.clientWidth);
      expect(count.getBoundingClientRect().right).toBeLessThanOrEqual(
        join.getBoundingClientRect().right,
      );
    });
  });

  describe("given more organizations than fit once the list is open", () => {
    /** @scenario Many organizations stay one clear choice and a short list */
    it("scrolls the list inside the card instead of growing it", async () => {
      renderStep({
        outcome: "ask",
        organizations: Array.from({ length: 30 }, (_, index) => ({
          organizationId: `org_${index}`,
          name: index === 0 ? "Acme" : `Acme team ${index}`,
          colleagueCount: index === 0 ? 10 : 1,
        })),
      });

      await userEvent
        .setup()
        .click(await screen.findByRole("button", { name: "Show all 29 organizations" }));
      const list = screen.getByTestId("join-other-organizations").querySelector("ul");
      if (!list) throw new Error("the open list did not render");

      await expect.poll(() => list.getBoundingClientRect().height).toBeLessThanOrEqual(264);
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
      expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        card().getBoundingClientRect().bottom,
      );
    });
  });
});
