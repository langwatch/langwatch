/**
 * @vitest-environment jsdom
 *
 * The organization's two sign-in security cards (GAC-09, GAC-10): what an
 * administrator is offered, and what the cards refuse to let through.
 *
 * Specs: specs/identity/org-account-lockout.feature,
 * specs/identity/org-session-lifetime.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionLimitCard, SignInLockoutCard } from "../SignInSecurityCards";
import type { SignInSecuritySettings } from "../useSignInSecurity";

const plan = { isEnterprise: true, isFree: false, isLoading: false };

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => plan,
}));
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true } }),
}));

/** What every organization holds until an administrator saves something. */
const NEVER_CONFIGURED: SignInSecuritySettings = {
  lockoutAfterFailedAttempts: 0,
  lockoutMinutes: 30,
  sessionIdleTimeoutMinutes: 0,
  sessionMaxLifetimeMinutes: 0,
};

const renderLockout = ({
  settings = NEVER_CONFIGURED,
  onSave = vi.fn(),
}: {
  settings?: SignInSecuritySettings;
  onSave?: (next: SignInSecuritySettings) => void;
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <SignInLockoutCard settings={settings} saving={false} onSave={onSave} />
    </ChakraProvider>,
  );
  return { onSave };
};

const renderSessionLimit = ({
  settings = NEVER_CONFIGURED,
  onSave = vi.fn(),
}: {
  settings?: SignInSecuritySettings;
  onSave?: (next: SignInSecuritySettings) => void;
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <SessionLimitCard settings={settings} saving={false} onSave={onSave} />
    </ChakraProvider>,
  );
  return { onSave };
};

const value = (testId: string) =>
  (screen.getByTestId(testId) as HTMLInputElement).value;

/**
 * Choose an option the way a person does.
 *
 * `userEvent`, not `fireEvent`, and the difference is not cosmetic here:
 * `fireEvent.click` on the label DOES flip the input's `checked` in jsdom, so
 * it looks like it worked — but it never reaches the component's own change
 * handler, so no state moves and the fields below never appear. A test
 * written with it passes its click and then fails to find anything, which
 * reads like a broken component rather than a broken click.
 */
const choose = async (label: string) =>
  await userEvent.click(screen.getByText(label));

beforeEach(() => {
  plan.isEnterprise = true;
  plan.isFree = false;
  plan.isLoading = false;
});

afterEach(() => {
  cleanup();
});

describe("given an organization that has never set a sign-in attempt threshold", () => {
  describe("when an administrator opens the sign-in security card", () => {
    /** @scenario "The threshold is offered with the numbers the control asks for" */
    it("offers five attempts and thirty minutes the moment it is turned on, and locks nobody before that", async () => {
      renderLockout();

      // Both choices are on screen from the start, with today's behaviour
      // selected — an administrator can see what the alternative IS without
      // having to flip something to find out.
      expect(screen.getByTestId("sign-in-lockout-never")).toBeChecked();
      expect(screen.getByTestId("sign-in-lockout-lock")).not.toBeChecked();
      // And no numbers yet: there is nothing to number until the rule exists.
      expect(screen.queryByTestId("sign-in-lockout-settings")).toBeNull();

      await choose("Temporary lockout");

      expect(value("sign-in-lockout-attempts")).toBe("5");
      expect(value("sign-in-lockout-minutes")).toBe("30");
    });

    it("saves nothing until Save is pressed", async () => {
      const { onSave } = renderLockout();

      await choose("Temporary lockout");

      expect(onSave).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that has never set a session window", () => {
  describe("when an administrator opens the session card", () => {
    /** @scenario "The window is offered with the numbers the control asks for" */
    it("offers one day of inactivity, leaves the maximum unset, and explains the saving effect", async () => {
      renderSessionLimit();

      expect(screen.getByTestId("session-limit-unbounded")).toBeChecked();

      await choose("Custom session limits");

      expect(screen.getByTestId("session-limit-card").textContent).toMatch(
        /signs out sessions already past the new limit/i,
      );

      // A day, not an hour: the number the box opens on is the one most
      // organizations keep, and an hour signs people out over lunch.
      expect(value("session-limit-idle")).toBe("1440");
      // Optional, and offered as genuinely unset rather than as a number
      // somebody has to notice and clear.
      expect(value("session-limit-maximum")).toBe("");
    });
  });
});

describe("given a maximum session length shorter than the inactivity limit", () => {
  describe("when both numbers are on screen together", () => {
    it("explains why it can never be reached and withholds Save", async () => {
      renderSessionLimit();
      await choose("Custom session limits");

      fireEvent.change(screen.getByTestId("session-limit-idle"), {
        target: { value: "120" },
      });
      fireEvent.change(screen.getByTestId("session-limit-maximum"), {
        target: { value: "60" },
      });

      expect(
        screen.getByTestId("session-limit-unreachable"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("session-limit-save")).toBeNull();
    });
  });
});

describe("given an administrator has changed a number", () => {
  describe("when they save", () => {
    it("sends every setting, carrying the other card's values through untouched", async () => {
      // Both cards write the same record, so each has to pass the other's
      // half along or saving one would quietly reset the other.
      const { onSave } = renderLockout({
        settings: {
          ...NEVER_CONFIGURED,
          sessionIdleTimeoutMinutes: 90,
          sessionMaxLifetimeMinutes: 480,
        },
      });

      await choose("Temporary lockout");
      await userEvent.click(screen.getByTestId("sign-in-lockout-save"));

      expect(onSave).toHaveBeenCalledWith({
        lockoutAfterFailedAttempts: 5,
        lockoutMinutes: 30,
        sessionIdleTimeoutMinutes: 90,
        sessionMaxLifetimeMinutes: 480,
      });
    });
  });

  describe("when nothing has been touched", () => {
    it("offers no Save at all", () => {
      renderLockout();

      expect(screen.queryByTestId("sign-in-lockout-save")).toBeNull();
    });
  });
});

describe("given an organization whose plan does not carry these rules", () => {
  describe("when nothing is turned on yet", () => {
    it("shows the card, explains the plan in the body, and will not let it be turned on", () => {
      plan.isEnterprise = false;
      plan.isFree = true;
      renderLockout();

      expect(screen.getByTestId("sign-in-lockout-card")).toBeInTheDocument();
      expect(
        screen.getByTestId("sign-in-security-plan-notice").textContent,
      ).toMatch(/Enterprise plan/i);
      expect(screen.getByTestId("sign-in-lockout-lock")).toBeDisabled();
    });
  });

  describe("when a rule was already saved before the plan lapsed", () => {
    it("still lets an administrator turn it off", () => {
      // Otherwise a lapsed plan becomes a lock-out its owner cannot undo.
      plan.isEnterprise = false;
      plan.isFree = true;
      renderLockout({
        settings: { ...NEVER_CONFIGURED, lockoutAfterFailedAttempts: 5 },
      });

      expect(screen.getByTestId("sign-in-lockout-lock")).not.toBeDisabled();
    });
  });
});
