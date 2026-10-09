/**
 * @vitest-environment jsdom
 *
 * The two-step verification challenge, as a state of the log-in card.
 *
 * The whole component tree renders under Chakra; only the auth client and the
 * navigation seam are mocked. The error registry is the REAL one, because what
 * the screen says about a refused code is most of what these tests are for —
 * and because "assert on the code, never the message" cuts both ways: the code
 * is what the assertions name, and the registry is what turns it into words.
 *
 * Spec: specs/identity/signin-signup-screens.feature,
 *       specs/identity/mfa-and-session-shape.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { verifyTotpMock, verifyBackupCodeMock, navigateMock } = vi.hoisted(
  () => ({
    verifyTotpMock: vi.fn(),
    verifyBackupCodeMock: vi.fn(),
    navigateMock: vi.fn(),
  }),
);

vi.mock("~/utils/auth-client", () => ({
  authClient: {
    twoFactor: {
      verifyTotp: verifyTotpMock,
      verifyBackupCode: verifyBackupCodeMock,
    },
  },
  navigate: navigateMock,
  safeRedirectTarget: (url?: string) => url ?? "/",
}));

import {
  _resetTwoStepChallengeForTests,
  endTwoStepChallenge,
  startTwoStepChallenge,
  useTwoStepChallenge,
} from "../../logic/twoStepChallenge";
import {
  TwoStepChallengePanel,
  twoStepChallengeTitle,
} from "../TwoStepChallengePanel";

/**
 * The panel inside a heading, which is how both doors compose it: the title
 * belongs to the CARD and changes with the factor, so a harness that rendered
 * the panel alone would be testing half the screen and would never notice a
 * swap that failed to retitle it.
 */
function ChallengeCard({ callbackUrl }: { callbackUrl?: string }) {
  const challenge = useTwoStepChallenge();
  if (!challenge) return <div data-testid="challenge-over" />;
  return (
    <div>
      <h1>{twoStepChallengeTitle(challenge.factor)}</h1>
      <TwoStepChallengePanel
        factor={challenge.factor}
        callbackUrl={callbackUrl}
      />
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
    verifyTotpMock.mockResolvedValue({ error: null });
    verifyBackupCodeMock.mockResolvedValue({ error: null });
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
      // A backup code is a thing you spend. It is one click away and never the
      // one offered first.
      expect(screen.getByTestId("two-step-swap-factor")).toHaveTextContent(
        /use a backup code instead/i,
      );
    });

    /** @scenario The challenge screen never says whether backup codes exist */
    it("offers the backup swap without claiming this account holds any", () => {
      renderChallenge();

      const swap = screen.getByTestId("two-step-swap-factor");
      // The offer describes what is POSSIBLE. Anything that named a count, or
      // said "you have backup codes", would be an oracle for the account.
      expect(swap.textContent).not.toMatch(/\d/);
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
        expect(verifyTotpMock).toHaveBeenCalledWith({ code: "123456" }),
      );
      expect(navigateMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("when the code is refused", () => {
    /** @scenario A refused code says why in words from the registry */
    it("shows the registered copy for the code, never the code or a raw message", async () => {
      verifyTotpMock.mockResolvedValue({
        error: { error: "identity_mfa_code_invalid" },
      });

      renderChallenge();
      await typeCode("000000");
      await submit();

      // The words come from the code-keyed registry. Asserting the copy here
      // rather than the code is deliberate: the point of the test is that a
      // person reads English, and the code is what produced it.
      expect(await screen.findByText(/that code didn't work/i)).toBeTruthy();
      expect(screen.queryByText(/identity_mfa_code_invalid/)).toBeNull();
      // The box is cleared: the next code is a different number.
      expect(screen.getByTestId("two-step-code")).toHaveValue("");
    });

    /** @scenario Repeated wrong codes stop the factor answering for a while */
    it("says how long to wait when the account is locked out", async () => {
      verifyTotpMock.mockResolvedValue({
        error: { error: "identity_mfa_locked_out" },
      });

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
      expect(
        await screen.findByText("Enter your verification code"),
      ).toBeTruthy();
    });

    /** @scenario A backup code works exactly once */
    it("sends a backup code to the backup endpoint, not the authenticator one", async () => {
      renderChallenge("/dashboard");
      await userEvent.click(screen.getByTestId("two-step-swap-factor"));

      await typeCode("ABCD-1234");
      await submit();

      await waitFor(() =>
        expect(verifyBackupCodeMock).toHaveBeenCalledWith({
          code: "ABCD-1234",
        }),
      );
      expect(verifyTotpMock).not.toHaveBeenCalled();
    });
  });

  describe("when the code is not finished being typed", () => {
    /** @scenario A rejected field says what to fix, next to the field */
    it("says what is missing and spends no attempt", async () => {
      renderChallenge();

      await typeCode("123");
      await submit();

      expect(await screen.findByText(/enter the 6-digit code/i)).toBeTruthy();
      // Attempts are budgeted. A half-typed code must not spend one.
      expect(verifyTotpMock).not.toHaveBeenCalled();
    });
  });

  describe("when the challenge is cancelled", () => {
    /** @scenario Cancelling the challenge goes back without signing anybody in */
    it("stands down, and nobody is signed in", async () => {
      renderChallenge();

      await userEvent.click(screen.getByTestId("two-step-cancel"));

      expect(await screen.findByTestId("challenge-over")).toBeTruthy();
      expect(navigateMock).not.toHaveBeenCalled();
      expect(verifyTotpMock).not.toHaveBeenCalled();
    });
  });
});
