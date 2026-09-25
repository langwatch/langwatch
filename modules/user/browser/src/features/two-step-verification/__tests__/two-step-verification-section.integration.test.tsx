/**
 * @vitest-environment jsdom
 *
 * The reader's own two-step verification on the security screen: where it
 * stands, who holds it on, and turning it off.
 * @see specs/identity/mfa-and-session-shape.feature
 */

import type { TwoStepAccountStanding } from "@langwatch/identity-contract";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import { TwoStepVerificationSection } from "../ui/sections/two-step-verification-section.tsx";

const { state, calls } = vi.hoisted(() => {
  const account: TwoStepAccountStanding = {
    offered: true,
    enabled: true,
    holdsPasskey: false,
    requiringOrganizations: [],
  };
  const refusal: unknown = void 0;
  return {
    state: { account, hasPassword: true, refusal },
    calls: { disable: vi.fn(), invalidate: vi.fn() },
  };
});

vi.mock("../behavior/two-step-verification-api.ts", () => ({
  twoStepVerificationApi: {
    useUtils: () => ({ twoStepVerification: { account: { invalidate: calls.invalidate } } }),
    twoStepVerification: {
      account: { useQuery: () => ({ data: state.account, isPending: false }) },
      disable: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: unknown,
            handlers: { onSuccess: () => void; onError: (error: unknown) => void },
          ) => {
            calls.disable(input);
            if (state.refusal) handlers.onError(state.refusal);
            else handlers.onSuccess();
          },
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {
    user: {
      hasPassword: { useQuery: () => ({ data: { hasPassword: state.hasPassword } }) },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.account = { offered: true, enabled: true, holdsPasskey: false, requiringOrganizations: [] };
  state.hasPassword = true;
  state.refusal = void 0;
});

afterEach(() => cleanup());

function renderSection() {
  const host = fakePersonalWorkspaceHost();
  renderWithPersonalWorkspaceHost(<TwoStepVerificationSection />, { host });
  return host;
}

async function openTurnOff() {
  fireEvent.click(screen.getByTestId("turn-off-two-factor"));
  await screen.findByTestId("turn-off-code");
}

async function turnOffWith({ password, code }: { password?: string; code: string }) {
  await openTurnOff();
  if (password !== void 0) {
    fireEvent.change(screen.getByTestId("turn-off-password"), { target: { value: password } });
  }
  fireEvent.change(screen.getByTestId("turn-off-code"), { target: { value: code } });
  fireEvent.click(screen.getByTestId("confirm-turn-off-two-factor"));
}

describe("given a deployment that offers no two-step verification", () => {
  it("draws nothing at all", () => {
    state.account = { ...state.account, offered: false, enabled: false };
    renderSection();

    expect(screen.queryByTestId("two-factor-section")).toBeNull();
  });
});

describe("given sam has two-step verification on and no organization requires it", () => {
  describe("when sam turns it off with the password and a current code", () => {
    it("sends both, says it is off, and rereads the standing", async () => {
      const host = renderSection();

      expect(screen.getByTestId("two-factor-status")).toBeTruthy();
      await turnOffWith({ password: "hunter2", code: "123456" });

      expect(calls.disable).toHaveBeenCalledWith({ password: "hunter2", code: "123456" });
      expect(host.recording.successes).toEqual([{ title: "Two-step verification is off" }]);
      expect(calls.invalidate).toHaveBeenCalled();
    });

    it("cannot be sent without the code", async () => {
      renderSection();
      await openTurnOff();
      fireEvent.change(screen.getByTestId("turn-off-password"), { target: { value: "hunter2" } });

      expect(screen.getByTestId("confirm-turn-off-two-factor")).toHaveProperty("disabled", true);
    });
  });

  describe("when the password does not match", () => {
    it("hands the refusal to the registry rather than printing the wire message", async () => {
      const refusal = { data: { code: "identity_mfa_password_invalid" } };
      state.refusal = refusal;
      const host = renderSection();

      await turnOffWith({ password: "wrong", code: "123456" });

      expect(host.recording.failures).toEqual([
        { error: refusal, fallbackTitle: "That wasn't turned off" },
      ]);
    });
  });

  describe("when sam's account holds no password", () => {
    it("asks for the code alone", async () => {
      state.hasPassword = false;
      renderSection();

      await openTurnOff();
      expect(screen.queryByTestId("turn-off-password")).toBeNull();
      fireEvent.change(screen.getByTestId("turn-off-code"), { target: { value: "123456" } });
      fireEvent.click(screen.getByTestId("confirm-turn-off-two-factor"));

      expect(calls.disable).toHaveBeenCalledWith({ code: "123456" });
    });
  });
});

describe("given acme requires two-step verification of sam", () => {
  describe("when sam reads the section", () => {
    it("names acme, holds the switch off, and offers leaving or asking an administrator", () => {
      state.account = {
        ...state.account,
        requiringOrganizations: [{ organizationId: "org-1", name: "acme", slug: "acme" }],
      };
      renderSection();

      expect(screen.getByTestId("turn-off-two-factor")).toHaveProperty("disabled", true);
      expect(screen.getByTestId("two-factor-held-by").textContent).toMatch(
        /acme requires two-step verification.*leave that organization, or ask an administrator/,
      );
    });
  });
});

describe("given sam has not set two-step verification up", () => {
  it("says it is off and offers no control it cannot honour", () => {
    state.account = { ...state.account, enabled: false };
    renderSection();

    expect(screen.getByTestId("two-factor-empty")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
