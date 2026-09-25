/**
 * @vitest-environment jsdom
 *
 * The shell around the card: one room, whoever runs the installation. The
 * ground and the value panel used to be hosted-only; now the deployment flag
 * changes nothing about the shell, and these tests hold both flag values to
 * the same rendering.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publicEnvRef } = vi.hoisted(() => ({
  publicEnvRef: { current: { IS_SAAS: false } as Record<string, unknown> },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { AuthCard } from "~/components/auth/AuthCard";
import { AuthShell } from "../AuthShell";

const renderShell = (props: Record<string, unknown> = {}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AuthShell
        headline="See what your agents are actually doing."
        headlineAccent="actually"
        tagline="traces · evaluations · online monitoring"
        {...props}
      >
        <AuthCard title="Log in to LangWatch">
          <p>the card</p>
        </AuthCard>
      </AuthShell>
    </ChakraProvider>,
  );

describe.each([
  ["a hosted deployment", true],
  ["a company's own installation", false],
])("given %s", (_label, isSaas) => {
  beforeEach(() => {
    publicEnvRef.current = { IS_SAAS: isSaas };
  });

  afterEach(() => cleanup());

  describe("when the auth screens renders", () => {
    /** @scenario The auth screens make their case beside the card, never inside it */
    it("puts the case in its own panel, with the card beside it", () => {
      renderShell();

      const panel = screen.getByTestId("auth-screen-value-panel");
      const headline = screen.getByTestId("auth-screen-headline");
      const card = screen.getByText("the card");

      expect(panel.contains(headline)).toBe(true);
      // The card is beside the panel, never inside it: the component that
      // authenticates somebody carries none of the pitch.
      expect(panel.contains(card)).toBe(false);
      expect(screen.getByTestId("auth-screen-card-column").contains(card)).toBe(
        true,
      );
      expect(screen.getByTestId("auth-screen-ambient")).toBeTruthy();
    });

    /** @scenario The auth screens make their case beside the card, never inside it */
    it("carries the gradient on one word and the tagline under it", () => {
      renderShell();

      expect(screen.getByTestId("auth-screen-headline")).toHaveTextContent(
        "See what your agents are actually doing.",
      );
      expect(
        screen.getByTestId("auth-screen-headline-accent"),
      ).toHaveTextContent("actually");
      expect(screen.getByTestId("auth-screen-tagline")).toBeTruthy();
    });

    /** @scenario The case panel claims nothing it has not been given */
    it("leaves the trusted-by slot out until something fills it", () => {
      renderShell();

      const panel = screen.getByTestId("auth-screen-value-panel");

      expect(screen.getByTestId("auth-screen-headline")).toBeTruthy();
      expect(screen.getByTestId("auth-screen-tagline")).toBeTruthy();
      expect(screen.queryByTestId("auth-screen-trust")).toBeNull();
      // Nothing borrowed: the wordmark is ours and lives in its own slot, so
      // the rest of the panel carries no mark at all. A row of integration
      // logos lived here once and argued the wrong thing — that we are
      // compatible, when the question being asked is whether anyone trusts us.
      const marks = panel.querySelectorAll("svg, img");
      const wordmark = screen.getByTestId("auth-screen-panel-logo");
      for (const mark of marks) {
        expect(wordmark.contains(mark)).toBe(true);
      }
    });

    it("keeps the field and centres the card when there is no case to make", () => {
      renderShell({ headline: undefined, tagline: undefined });

      expect(screen.queryByTestId("auth-screen-value-panel")).toBeNull();
      // The ground stays: a headline-less screen is a centred card on the
      // same field, never a bare page.
      expect(screen.getByTestId("auth-screen-ambient")).toBeTruthy();
      expect(screen.getByText("the card")).toBeTruthy();
    });
  });
});
