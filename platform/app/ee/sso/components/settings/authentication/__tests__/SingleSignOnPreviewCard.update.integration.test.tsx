/**
 * @vitest-environment jsdom
 *
 * The overview card for a connection that is not live yet, while an update to
 * the organization's own identity provider is under way (ADR-124 §6).
 *
 * A replacement sits in REGISTERED for the whole of its setup, so the card
 * describing it would report "still setting up" about an organization whose
 * entire company is signing in through the connection it replaces. The update
 * outranks the lifecycle state, and it wears the words the single sign-on page
 * uses for the same state.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { SingleSignOnPreviewCard } from "../SingleSignOnPreviewCard";

function renderCard(
  props: Parameters<typeof SingleSignOnPreviewCard>[0] = {},
) {
  return render(
    <MemoryRouter>
      <ChakraProvider value={defaultSystem}>
        <SingleSignOnPreviewCard {...props} />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("given an update that has started but has not gone live", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "Once it is under way, the overview says where the update got to" */
    it("wears the update's own status word and points at the page that owns it", () => {
      renderCard({ state: "REGISTERED", canManage: true, updatePhase: "SETUP" });

      expect(screen.getByText("Setting up")).toBeDefined();
      expect(
        screen
          .getByTestId("single-sign-on-preview-action")
          .getAttribute("href"),
      ).toBe("/settings/authentication/provider");
      // The half-built connection's own word, which is true of the row and
      // useless to the reader, is not what the card says.
      expect(screen.queryByText("Carry on setting it up")).toBeNull();
    });

    /** @scenario "Once it is under way, the overview says where the update got to" */
    it("says the same thing in every phase the update passes through", () => {
      for (const [phase, label] of [
        ["SETUP", "Setting up"],
        ["GRACE_LEGACY", "Testing"],
        ["GRACE_DIRECT", "Switched over"],
        ["FINALIZING", "Finishing"],
        ["FINALIZED", "Complete"],
      ] as const) {
        renderCard({ state: "REGISTERED", updatePhase: phase });
        expect(screen.getByText(label)).toBeDefined();
        cleanup();
      }
    });
  });
});

describe("given a connection with no update under way", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("keeps the setup journey's own words and offers no update status", () => {
      renderCard({ state: "REGISTERED", canManage: true });

      expect(screen.getByText("Carry on setting it up")).toBeDefined();
      for (const label of [
        "Setting up",
        "Testing",
        "Switched over",
        "Finishing",
        "Complete",
      ]) {
        expect(screen.queryByText(label)).toBeNull();
      }
    });

    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("says so plainly when there is no connection at all", () => {
      renderCard({ canManage: true });

      expect(screen.getByText("Not set up")).toBeDefined();
      expect(screen.getByText("Set it up")).toBeDefined();
    });
  });
});
