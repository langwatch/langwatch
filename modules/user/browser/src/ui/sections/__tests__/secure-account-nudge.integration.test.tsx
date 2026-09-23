/**
 * @vitest-environment jsdom
 *
 * The account-security offer after sign-in (ADR-120, D06). Spec: specs/identity/passkeys.feature
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakePersonalWorkspaceHost, renderWithPersonalWorkspaceHost } from "../../../testing.tsx";
import SecureAccountNudge from "../secure-account-nudge.tsx";

type Offer = {
  offer: boolean;
  passkey: boolean;
  twoStep: boolean;
  signedInWith: "password" | "passkey" | "federated" | "unknown";
};

const { state, calls } = vi.hoisted(() => ({
  state: { offer: undefined as Offer | undefined, order: [] as string[] },
  calls: {
    dismiss: vi.fn(),
    cancel: vi.fn(),
    setData: vi.fn(),
    invalidate: vi.fn(),
  },
}));

vi.mock("../../../behavior/personal-workspace-api.ts", () => {
  const api = {
    useUtils: () => ({
      user: {
        secureAccountNudge: {
          cancel: async () => {
            state.order.push("cancel");
            calls.cancel();
          },
          setData: (
            _input: unknown,
            update: (previous: Offer | undefined) => Offer | undefined,
          ) => {
            state.order.push("setData");
            calls.setData(update(state.offer));
          },
          invalidate: calls.invalidate,
        },
      },
    }),
    user: {
      secureAccountNudge: { useQuery: () => ({ data: state.offer }) },
      dismissSecureAccountNudge: {
        useMutation: (options: unknown) => ({
          mutate: (input: unknown) => {
            state.order.push("dismiss");
            calls.dismiss(input, options);
          },
        }),
      },
    },
  };
  return { personalWorkspaceApi: api, api };
});

const BOTH: Offer = { offer: true, passkey: true, twoStep: true, signedInWith: "password" };

beforeEach(() => {
  state.offer = BOTH;
  state.order = [];
  for (const call of Object.values(calls)) call.mockReset();
});

afterEach(() => cleanup());

describe("given somebody who signed in with a password and lacks both", () => {
  /** @scenario "The passkey offer follows a password, not a federated sign-in" */
  it("offers a passkey and two-step verification in one dialog", () => {
    renderWithPersonalWorkspaceHost(<SecureAccountNudge />, { host: fakePersonalWorkspaceHost() });

    expect(screen.getByText("Sign in faster next time")).toBeTruthy();
    expect(screen.getByTestId("nudge-create-passkey")).toBeTruthy();
    expect(screen.getByTestId("nudge-set-up-two-step")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });
});

describe("given a sign-in that was not a password", () => {
  /** @scenario "The passkey offer follows a password, not a federated sign-in" */
  it.each(["passkey", "federated", "unknown"] as const)(
    "shows nothing after a %s sign-in",
    (signedInWith) => {
      state.offer = { ...BOTH, signedInWith };
      renderWithPersonalWorkspaceHost(<SecureAccountNudge />, {
        host: fakePersonalWorkspaceHost(),
      });

      expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
    },
  );
});

describe("given only two-step verification is on offer", () => {
  it("asks to secure the account, with two-step verification as the way to do it", () => {
    state.offer = { ...BOTH, passkey: false };
    renderWithPersonalWorkspaceHost(<SecureAccountNudge />, { host: fakePersonalWorkspaceHost() });

    expect(screen.getByText("Secure your account")).toBeTruthy();
    expect(screen.queryByTestId("nudge-create-passkey")).toBeNull();
  });
});

describe("when the person answers Not now", () => {
  /** @scenario "A dismissal is remembered on the next page, not just in the dialog" */
  it("tells the account first, in a request that outlives the page, then closes the cached offer", async () => {
    renderWithPersonalWorkspaceHost(<SecureAccountNudge />, { host: fakePersonalWorkspaceHost() });

    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    await waitFor(() => expect(calls.setData).toHaveBeenCalled());
    expect(state.order).toEqual(["dismiss", "cancel", "setData"]);
    expect(calls.dismiss.mock.calls[0]?.[1]).toMatchObject({
      trpc: { context: { keepalive: true } },
    });
    expect(calls.setData).toHaveBeenCalledWith({ ...BOTH, offer: false });
    expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
  });
});

describe("when the person chooses to set up two-step verification", () => {
  it("answers the offer on the way, then goes to the Security settings", async () => {
    const host = fakePersonalWorkspaceHost();
    renderWithPersonalWorkspaceHost(<SecureAccountNudge />, { host });

    await userEvent.click(screen.getByTestId("nudge-set-up-two-step"));

    await waitFor(() => expect(host.recording.navigations).toEqual(["/settings/security"]));
    expect(calls.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("when the device's own passkey prompt is closed", () => {
  it("records it as Not now and reports no failure", async () => {
    const host = fakePersonalWorkspaceHost({ passkeyOutcome: { ok: false, cancelled: true } });
    renderWithPersonalWorkspaceHost(<SecureAccountNudge />, { host });

    await userEvent.click(screen.getByTestId("nudge-create-passkey"));

    await waitFor(() => expect(calls.dismiss).toHaveBeenCalledTimes(1));
    expect(host.recording.failures).toEqual([]);
  });
});

describe("when a passkey is created", () => {
  it("says so and closes, without recording a dismissal", async () => {
    const host = fakePersonalWorkspaceHost();
    renderWithPersonalWorkspaceHost(<SecureAccountNudge />, { host });

    await userEvent.click(screen.getByTestId("nudge-create-passkey"));

    await waitFor(() => expect(host.recording.successes).toEqual([{ title: "Passkey created" }]));
    expect(calls.dismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId("secure-account-nudge")).toBeNull();
  });
});
