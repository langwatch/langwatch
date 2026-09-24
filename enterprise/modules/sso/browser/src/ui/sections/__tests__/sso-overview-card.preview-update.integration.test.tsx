/**
 * @vitest-environment jsdom
 * The overview card for a connection not live yet, while an update to the
 * organization's own identity provider is under way (ADR-124 §6): the update
 * outranks the lifecycle state. Spec: specs/identity/sso-idp-termination.feature
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { SingleSignOnPreviewCard } from "../sso-overview-card.tsx";

const renderCard = (props: ComponentProps<typeof SingleSignOnPreviewCard> = {}) =>
  renderWithSsoHost(<SingleSignOnPreviewCard {...props} />);

afterEach(cleanup);

describe("given an update that has started but has not gone live", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "Once it is under way, the overview says where the update got to" */
    it("wears the update's own status word and points at the page that owns it", () => {
      renderCard({ state: "DRAFT", canManage: true, updatePhase: "SETUP" });

      expect(screen.getByText("Setting up")).toBeInTheDocument();
      expect(screen.getByTestId("single-sign-on-preview-action")).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
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
        renderCard({ state: "DRAFT", updatePhase: phase });
        expect(screen.getByText(label)).toBeInTheDocument();
        cleanup();
      }
    });
  });
});

describe("given a connection with no update under way", () => {
  describe("when an administrator opens Authentication", () => {
    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("keeps the setup journey's own words and offers no update status", () => {
      renderCard({ state: "DRAFT", canManage: true });

      expect(screen.getByText("Carry on setting it up")).toBeInTheDocument();
      for (const label of ["Setting up", "Testing", "Switched over", "Finishing", "Complete"]) {
        expect(screen.queryByText(label)).toBeNull();
      }
    });

    /** @scenario "An organization is offered its own identity provider on the Authentication overview" */
    it("says so plainly when there is no connection at all", () => {
      renderCard({ canManage: true });

      expect(screen.getByText("Not set up")).toBeInTheDocument();
      expect(screen.getByText("Set it up")).toBeInTheDocument();
    });
  });
});
