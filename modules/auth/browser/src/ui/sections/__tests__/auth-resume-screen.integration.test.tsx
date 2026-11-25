/**
 * @vitest-environment jsdom
 *
 * The page better-auth returns a provider sign-in to when the real
 * destination fails its callbackURL check. Only the navigation is mocked.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockReplaceLocation } = vi.hoisted(() => ({
  mockReplaceLocation: vi.fn(),
}));

vi.mock("../../../behavior/browser-navigation.ts", () => ({
  replaceLocation: mockReplaceLocation,
  hardNavigate: vi.fn(),
  reloadPage: vi.fn(),
}));

import AuthResume from "../auth-resume-screen.tsx";

const STORAGE_KEY = "langwatch.auth.returnTo";
const PARKED_TARGET =
  "/acme-x7f2/agent-testing/results/external:scenario_tests/scenariobatch_01K6ZQ8M3V?drawer.open=scenarioRunDetail&drawer.scenarioSetId=scenario_tests";

const renderPage = ({ strict = false } = {}) =>
  renderWithDesignSystem(
    strict ? (
      <StrictMode>
        <AuthResume />
      </StrictMode>
    ) : (
      <AuthResume />
    ),
  );

beforeEach(() => {
  window.sessionStorage.clear();
  mockReplaceLocation.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AuthResume", () => {
  describe("given a page with a colon in its address was parked", () => {
    beforeEach(() => {
      window.sessionStorage.setItem(STORAGE_KEY, PARKED_TARGET);
    });

    describe("when the page opens", () => {
      /** @scenario "The resume page forwards once to the parked page" */
      it("forwards to that page and clears the slot", () => {
        renderPage();

        expect(mockReplaceLocation).toHaveBeenCalledTimes(1);
        expect(mockReplaceLocation).toHaveBeenCalledWith(PARKED_TARGET);
        expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
      });
    });

    describe("when the page renders under StrictMode", () => {
      /** @scenario "The resume page forwards once to the parked page" */
      it("forwards exactly once", () => {
        renderPage({ strict: true });

        expect(mockReplaceLocation).toHaveBeenCalledTimes(1);
        expect(mockReplaceLocation).toHaveBeenCalledWith(PARKED_TARGET);
      });
    });
  });

  describe("given nothing was parked", () => {
    describe("when the page opens", () => {
      it("goes to the home page", () => {
        renderPage();

        expect(mockReplaceLocation).toHaveBeenCalledWith("/");
      });
    });
  });

  describe("given the parked address points at another site", () => {
    describe("when the page opens", () => {
      /** @scenario "A parked destination on another site falls back to the home page" */
      it("goes to the home page instead", () => {
        window.sessionStorage.setItem(STORAGE_KEY, "//evil.com");

        renderPage();

        expect(mockReplaceLocation).toHaveBeenCalledWith("/");
      });
    });
  });
});
