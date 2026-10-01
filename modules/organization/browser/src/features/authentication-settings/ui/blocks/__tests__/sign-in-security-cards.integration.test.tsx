/**
 * @vitest-environment jsdom
 * The two sign-in security cards: each keeps its own draft and hands the
 * whole settings object back on save.
 * @see specs/identity/org-session-lifetime.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_IN_SECURITY_OFF } from "../../../model/sign-in-security.ts";
import { SessionLimitCard, SignInLockoutCard } from "../sign-in-security-cards.tsx";

afterEach(cleanup);

const renderCard = (card: React.ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{card}</ChakraProvider>);

describe("the account lockout card", () => {
  describe("given lockout is off", () => {
    it("offers the lock and saves the offered threshold", async () => {
      const onSave = vi.fn();
      renderCard(
        <SignInLockoutCard settings={SIGN_IN_SECURITY_OFF} saving={false} onSave={onSave} />,
      );

      expect(screen.queryByTestId("sign-in-lockout-save")).toBeNull();
      // userEvent, not fireEvent: Chakra's radio group only hears a real click.
      await userEvent.click(screen.getByText("Temporary lockout"));
      await userEvent.click(screen.getByTestId("sign-in-lockout-save"));

      expect(onSave).toHaveBeenCalledWith({
        ...SIGN_IN_SECURITY_OFF,
        lockoutAfterFailedAttempts: 5,
        lockoutMinutes: 30,
      });
    });
  });
});

describe("the session limits card", () => {
  describe("given a maximum shorter than the idle timeout", () => {
    it("warns that it would never be reached and offers no save", () => {
      renderCard(
        <SessionLimitCard
          settings={{ ...SIGN_IN_SECURITY_OFF, sessionIdleTimeoutMinutes: 60 }}
          saving={false}
          onSave={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByTestId("session-limit-maximum"), { target: { value: "30" } });

      expect(screen.getByTestId("session-limit-unreachable")).toBeTruthy();
      expect(screen.queryByTestId("session-limit-save")).toBeNull();
    });
  });

  describe("given a sensible window", () => {
    it("saves both numbers", () => {
      const onSave = vi.fn();
      renderCard(
        <SessionLimitCard
          settings={{ ...SIGN_IN_SECURITY_OFF, sessionIdleTimeoutMinutes: 60 }}
          saving={false}
          onSave={onSave}
        />,
      );

      fireEvent.change(screen.getByTestId("session-limit-maximum"), { target: { value: "480" } });
      fireEvent.click(screen.getByTestId("session-limit-save"));

      expect(onSave).toHaveBeenCalledWith({
        ...SIGN_IN_SECURITY_OFF,
        sessionIdleTimeoutMinutes: 60,
        sessionMaxLifetimeMinutes: 480,
      });
    });
  });
});
