/**
 * @vitest-environment jsdom
 *
 * Unit tests for IntegrationCTACard rendering and dismiss logic.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ─── Mutable state ────────────────────────────────────────────────────────────

let mockHasAnyTraces: boolean | undefined = false;
let mockIntegrationCtaDismissedAtByProject: Record<string, number> = {};
const mockSetDismissedAt = vi.fn();

// ─── Dependency mocks ─────────────────────────────────────────────────────────

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-cta-test" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../hooks/useProjectHasTraces", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: mockHasAnyTraces }),
}));

vi.mock("../store/onboardingStore", () => ({
  useOnboardingStore: (selector: (s: unknown) => unknown) =>
    selector({
      integrationCtaDismissedAtByProject: mockIntegrationCtaDismissedAtByProject,
      setIntegrationCtaDismissedAt: mockSetDismissedAt,
    }),
}));

// Stub the IntegrateDrawer so it doesn't pull in heavy deps
vi.mock("../components/IntegrateDrawer", () => ({
  IntegrateDrawer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="integrate-drawer">Drawer</div> : null,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import React from "react";
import { IntegrationCTACard } from "../components/IntegrationCTACard";

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockHasAnyTraces = false;
  mockIntegrationCtaDismissedAtByProject = {};
});

function renderCard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IntegrationCTACard />
    </ChakraProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<IntegrationCTACard />", () => {
  describe("given project has no real traces", () => {
    describe("when the card has never been dismissed", () => {
      it("renders the integration CTA", () => {
        renderCard();
        expect(screen.getByTestId("integration-cta-card")).toBeInTheDocument();
      });

      it("shows the integrate button", () => {
        renderCard();
        expect(
          screen.getByRole("button", { name: /integrate/i }),
        ).toBeInTheDocument();
      });
    });

    describe("when the card was dismissed less than 14 days ago", () => {
      it("does not render", () => {
        mockIntegrationCtaDismissedAtByProject = {
          "proj-cta-test": Date.now() - 1000 * 60 * 60, // 1 hour ago
        };
        renderCard();
        expect(
          screen.queryByTestId("integration-cta-card"),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the card was dismissed more than 14 days ago", () => {
      it("renders again (snooze expired)", () => {
        const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
        mockIntegrationCtaDismissedAtByProject = {
          "proj-cta-test": Date.now() - fifteenDaysMs,
        };
        renderCard();
        expect(screen.getByTestId("integration-cta-card")).toBeInTheDocument();
      });
    });

    describe("when user clicks the dismiss button", () => {
      it("calls setIntegrationCtaDismissedAt with the project id and a timestamp", () => {
        const before = Date.now();
        renderCard();
        fireEvent.click(
          screen.getByRole("button", { name: /dismiss integration prompt/i }),
        );
        expect(mockSetDismissedAt).toHaveBeenCalledOnce();
        const [calledProjectId, calledTs] = mockSetDismissedAt.mock
          .calls[0] as [string, number];
        expect(calledProjectId).toBe("proj-cta-test");
        expect(calledTs).toBeGreaterThanOrEqual(before);
      });
    });

    describe("when user clicks 'Remind me later'", () => {
      it("calls setIntegrationCtaDismissedAt", () => {
        renderCard();
        fireEvent.click(
          screen.getByRole("button", { name: /remind me later/i }),
        );
        expect(mockSetDismissedAt).toHaveBeenCalledOnce();
      });
    });
  });

  describe("given project has real traces", () => {
    describe("when hasAnyTraces is true", () => {
      it("does not render the CTA", () => {
        mockHasAnyTraces = true;
        renderCard();
        expect(
          screen.queryByTestId("integration-cta-card"),
        ).not.toBeInTheDocument();
      });
    });
  });
});
