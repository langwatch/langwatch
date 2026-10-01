/**
 * @vitest-environment jsdom
 *
 * The enrolment gate the shell draws in place of an organization's page body.
 * The store below is the server changing its answer for the same session.
 * @see specs/identity/mfa-and-session-shape.feature
 */

import type { OrganizationMfaStanding } from "@langwatch/identity-contract";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import OrganizationMfaGate from "../ui/sections/organization-mfa-gate.tsx";

const { state, calls } = vi.hoisted(() => {
  const state: { standing: OrganizationMfaStanding | undefined; asked: string[] } = {
    standing: void 0,
    asked: [],
  };
  return { state, calls: { refetch: vi.fn() } };
});

const HELD: OrganizationMfaStanding = {
  organizationId: "acme",
  organizationName: "Acme",
  required: true,
  satisfaction: { satisfied: false, by: "none" },
  holdsPasskey: false,
};

vi.mock("../behavior/two-step-verification-api.ts", () => ({
  twoStepVerificationApi: {
    twoStepVerification: {
      standing: {
        useQuery: (input: { organizationId: string }, options: { enabled: boolean }) => {
          if (options.enabled) state.asked.push(input.organizationId);
          return { data: options.enabled ? state.standing : void 0, refetch: calls.refetch };
        },
      },
    },
  },
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => ({
  personalWorkspaceApi: {
    user: { hasPassword: { useQuery: () => ({ data: { hasPassword: false } }) } },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.standing = HELD;
  state.asked = [];
});

afterEach(() => cleanup());

function renderGate({ isPersonalScope = false }: { isPersonalScope?: boolean } = {}) {
  const host = fakePersonalWorkspaceHost();
  const view = renderWithPersonalWorkspaceHost(
    <OrganizationMfaGate organizationId="acme" isPersonalScope={isPersonalScope}>
      <div>acme's data</div>
    </OrganizationMfaGate>,
    { host },
  );
  return { host, view };
}

describe("given acme requires two-step verification and sam has none", () => {
  describe("when sam opens one of acme's pages", () => {
    /** @scenario "A member who cannot prove one is held out of that organization alone" */
    it("offers the setup in place of acme's data, naming acme as the one asking", () => {
      renderGate();

      expect(screen.getByTestId("organization-mfa-gate")).toBeTruthy();
      expect(screen.getByText("Acme requires two-step verification")).toBeTruthy();
      expect(screen.getByTestId("start-two-factor")).toBeTruthy();
      expect(screen.queryByText("acme's data")).toBeNull();
    });

    it("leaves sam's personal workspace reachable, and never asks there", () => {
      renderGate({ isPersonalScope: true });

      expect(screen.getByText("acme's data")).toBeTruthy();
      expect(state.asked).toEqual([]);
    });

    it("names the passkey as a second way through to someone who holds one", () => {
      state.standing = { ...HELD, holdsPasskey: true };
      renderGate();

      expect(screen.getByTestId("organization-mfa-gate-passkey")).toBeTruthy();
    });
  });

  describe("when sam finishes setting it up", () => {
    /** @scenario "Setting it up opens the gate on the session they already hold" */
    it("asks the standing again on the same session and opens acme's data", async () => {
      const { host, view } = renderGate();

      fireEvent.click(screen.getByTestId("start-two-factor"));
      fireEvent.change(await screen.findByTestId("two-factor-code"), {
        target: { value: "123456" },
      });
      fireEvent.click(screen.getByTestId("confirm-two-factor"));
      fireEvent.click(await screen.findByTestId("backup-codes-done"));

      expect(calls.refetch).toHaveBeenCalled();
      expect(host.recording.sessionRefreshes).toBe(0);

      state.standing = { ...HELD, satisfaction: { satisfied: true, by: "account_enrollment" } };
      view.rerender(
        <OrganizationMfaGate organizationId="acme" isPersonalScope={false}>
          <div>acme's data</div>
        </OrganizationMfaGate>,
      );
      await waitFor(() => expect(screen.getByText("acme's data")).toBeTruthy());
    });
  });
});

describe("given acme turns the requirement off", () => {
  /** @scenario "Turning the requirement off lets the held members straight back in" */
  it("draws acme's data without asking sam to sign in again", () => {
    state.standing = {
      ...HELD,
      required: false,
      satisfaction: { satisfied: true, by: "not_required" },
    };
    const { host } = renderGate();

    expect(screen.getByText("acme's data")).toBeTruthy();
    expect(host.recording.sessionRefreshes).toBe(0);
  });
});
