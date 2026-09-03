/**
 * @vitest-environment jsdom
 *
 * The shell around the card: what a hosted deployment says beside the door,
 * and what a company's own installation does not say at all. The card is the
 * same component either way — everything here is composed around it.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publicEnvRef } = vi.hoisted(() => ({
  publicEnvRef: { current: { IS_SAAS: false } as Record<string, unknown> },
}));

vi.mock("../../../behavior/use-public-env", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { AuthCard } from "../../elements/auth-card";
import { FrontDoorShell } from "../front-door-shell";

const renderShell = (props: Record<string, unknown> = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FrontDoorShell
        headline="See what your agents are actually doing."
        headlineAccent="actually"
        tagline="traces · evaluations · online monitoring"
        {...props}
      >
        <AuthCard title="Log in to LangWatch">
          <p>the card</p>
        </AuthCard>
      </FrontDoorShell>
    </ChakraProvider>,
  );

describe("given a hosted deployment", () => {
  beforeEach(() => {
    publicEnvRef.current = { IS_SAAS: true };
  });

  afterEach(() => cleanup());

  describe("when the front door renders", () => {
    /** @scenario The hosted front door makes its case beside the card, never inside it */
    it("puts the case in its own panel, with the card beside it", () => {
      renderShell();

      const panel = screen.getByTestId("front-door-value-panel");
      const headline = screen.getByTestId("front-door-headline");
      const card = screen.getByText("the card");

      expect(panel.contains(headline)).toBe(true);
      // The card is beside the panel, never inside it: the component that
      // authenticates somebody carries none of the pitch.
      expect(panel.contains(card)).toBe(false);
      expect(screen.getByTestId("front-door-card-column").contains(card)).toBe(true);
      expect(screen.getByTestId("front-door-ambient")).toBeTruthy();
    });

    /** @scenario The hosted front door makes its case beside the card, never inside it */
    it("carries the gradient on one word and the tagline under it", () => {
      renderShell();

      expect(screen.getByTestId("front-door-headline")).toHaveTextContent(
        "See what your agents are actually doing.",
      );
      expect(screen.getByTestId("front-door-headline-accent")).toHaveTextContent("actually");
      expect(screen.getByTestId("front-door-tagline")).toBeTruthy();
    });

    /** @scenario The case panel claims nothing it has not been given */
    it("leaves the trusted-by slot out until something fills it", () => {
      renderShell();

      const panel = screen.getByTestId("front-door-value-panel");

      expect(screen.getByTestId("front-door-headline")).toBeTruthy();
      expect(screen.getByTestId("front-door-tagline")).toBeTruthy();
      expect(screen.queryByTestId("front-door-trust")).toBeNull();
      // Nothing borrowed: the wordmark is ours and lives in its own slot, so
      // the rest of the panel carries no mark at all. A row of integration
      // logos lived here once and argued the wrong thing — that we are
      // compatible, when the question being asked is whether anyone trusts us.
      const marks = panel.querySelectorAll("svg, img");
      const wordmark = screen.getByTestId("front-door-panel-logo");
      for (const mark of marks) {
        expect(wordmark.contains(mark)).toBe(true);
      }
    });

    it("renders the plain card when there is no case to make", () => {
      renderShell({ headline: undefined, tagline: undefined });

      expect(screen.queryByTestId("front-door-value-panel")).toBeNull();
      expect(screen.getByText("the card")).toBeTruthy();
    });
  });
});

describe("given a company's own installation", () => {
  beforeEach(() => {
    publicEnvRef.current = { IS_SAAS: false };
  });

  afterEach(() => cleanup());

  describe("when the front door renders", () => {
    /** @scenario The hosted front door makes its case beside the card, never inside it */
    it("shows the card alone, with nothing sold beside it", () => {
      renderShell();

      expect(screen.queryByTestId("front-door-value-panel")).toBeNull();
      expect(screen.queryByTestId("front-door-headline")).toBeNull();
      expect(screen.queryByTestId("front-door-ambient")).toBeNull();
      expect(screen.getByText("the card")).toBeTruthy();
    });
  });
});
