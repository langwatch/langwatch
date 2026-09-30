/**
 * @vitest-environment jsdom
 * The two-step challenge as a state of the log-in card. Only the verify call
 * and navigation are mocked; the error registry is the real one.
 * Spec: specs/identity/signin-signup-screens.feature, mfa-and-session-shape.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyMock, navigateMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../behavior/ui-two-factor.ts", () => ({
  verifyUiTwoStepChallenge: verifyMock,
}));

vi.mock("../../../behavior/auth-client.tsx", () => ({
  navigate: navigateMock,
  safeRedirectTarget: (url?: string) => url ?? "/",
}));

import {
  _resetTwoStepChallengeForTests,
  endTwoStepChallenge,
  startTwoStepChallenge,
  useTwoStepChallenge,
} from "../../../model/two-step-challenge.ts";
import { TwoStepChallengePanel, twoStepChallengeTitle } from "../two-step-challenge-panel.tsx";

/** The panel under its card's heading, which changes with the factor. */
function ChallengeCard({ callbackUrl }: { callbackUrl?: string }) {
  const challenge = useTwoStepChallenge();
  if (!challenge) return <div data-testid="challenge-over" />;
  return (
    <div>
      <h1>{twoStepChallengeTitle({ factor: challenge.factor })}</h1>
      <TwoStepChallengePanel factor={challenge.factor} callbackUrl={callbackUrl} />
    </div>
  );
}

const renderChallenge = (callbackUrl?: string) => {
  startTwoStepChallenge({ callbackUrl });
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChallengeCard callbackUrl={callbackUrl} />
    </ChakraProvider>,
  );
};

const typeCode = async (code: string) => {
  const field = screen.getByTestId("two-step-code");
  await userEvent.clear(field);
  await userEvent.type(field, code);
};

const submit = async () => {
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
};

describe("given a password that was accepted and a second factor still owed", () => {
  beforeEach(() => {
    verifyMock.mockResolvedValue({ ok: true, value: { verified: true } });
  });

  afterEach(() => {
    cleanup();
    endTwoStepChallenge();
    _resetTwoStepChallengeForTests();
    vi.clearAllMocks();
  });

  describe("when the challenge screen opens", () => {
    /** @scenario A correct password with a second factor asks for the code on the same card */
    it("asks for the authenticator code first, and offers the backup swap", () => {
      renderChallenge();

      expect(screen.getByText("Enter your verification code")).toBeTruthy();
      expect(screen.getByTestId("two-step-code")).toBeTruthy();
      expect(screen.getByTestId("two-step-swap-factor")).toHaveTextContent(
        /use a backup code instead/i,
      );
    });

    /** @scenario The challenge screen never says whether backup codes exist */
    it("offers the backup swap without claiming this account holds any", () => {
      renderChallenge();

      expect(screen.getByTestId("two-step-swap-factor").textContent).not.toMatch(/\d/);
      expect(document.body.textContent).not.toMatch(/you have|remaining|left/i);
    });
  });

  describe("when a correct code is entered", () => {
    /** @scenario A correct password with a second factor asks for the code on the same card */
    it("verifies it and takes them where they were going", async () => {
      renderChallenge("/dashboard");

      await typeCode("123456");
      await submit();

      await waitFor(() =>
        expect(verifyMock).toHaveBeenCalledWith({ code: "123456", isBackupCode: false }),
      );
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("when the code is refused", () => {
    /** @scenario A refused code says why in words from the registry */
    it("shows the registered copy for the code, never the code or a raw message", async () => {
      verifyMock.mockResolvedValue({ ok: false, error: { error: "identity_mfa_code_invalid" } });

      renderChallenge();
      await typeCode("000000");
      await submit();

      expect(await screen.findByText(/that code didn't work/i)).toBeTruthy();
      expect(screen.queryByText(/identity_mfa_code_invalid/)).toBeNull();
      expect(screen.getByTestId("two-step-code")).toHaveValue("");
    });

    /** @scenario Repeated wrong codes stop the factor answering for a while */
    it("says how long to wait when the account is locked out", async () => {
      verifyMock.mockResolvedValue({ ok: false, error: { error: "identity_mfa_locked_out" } });

      renderChallenge();
      await typeCode("000000");
      await submit();

      expect(await screen.findByText(/too many incorrect codes/i)).toBeTruthy();
      expect(screen.getByText(/wait a few minutes/i)).toBeTruthy();
    });
  });

  describe("when the backup code box is asked for", () => {
    /** @scenario The challenge screen never says whether backup codes exist */
    it("swaps the box, and swaps back", async () => {
      renderChallenge();

      await userEvent.click(screen.getByTestId("two-step-swap-factor"));

      expect(await screen.findByText("Enter a backup code")).toBeTruthy();
      expect(screen.getByTestId("two-step-swap-factor")).toHaveTextContent(
        /use your authenticator app instead/i,
      );

      await userEvent.click(screen.getByTestId("two-step-swap-factor"));
      expect(await screen.findByText("Enter your verification code")).toBeTruthy();
    });

    /** @scenario A backup code works exactly once */
    it("sends a backup code as a backup code, not an authenticator code", async () => {
      renderChallenge("/dashboard");
      await userEvent.click(screen.getByTestId("two-step-swap-factor"));

      await typeCode("ABCD-1234");
      await submit();

      await waitFor(() =>
        expect(verifyMock).toHaveBeenCalledWith({ code: "ABCD-1234", isBackupCode: true }),
      );
      expect(verifyMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the code is not finished being typed", () => {
    /** @scenario A rejected field says what to fix, next to the field */
    it("says what is missing and spends no attempt", async () => {
      renderChallenge();

      await typeCode("123");
      await submit();

      expect(await screen.findByText(/enter the 6-digit code/i)).toBeTruthy();
      expect(verifyMock).not.toHaveBeenCalled();
    });
  });

  describe("when the challenge is cancelled", () => {
    /** @scenario Cancelling the challenge goes back without signing anybody in */
    it("stands down, and nobody is signed in", async () => {
      renderChallenge();

      await userEvent.click(screen.getByTestId("two-step-cancel"));

      expect(await screen.findByTestId("challenge-over")).toBeTruthy();
      expect(navigateMock).not.toHaveBeenCalled();
      expect(verifyMock).not.toHaveBeenCalled();
    });
  });
});
