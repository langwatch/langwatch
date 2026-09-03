/**
 * @vitest-environment jsdom
 *
 * Settings → SCIM: the address an identity provider posts to, and the token it
 * authenticates with.
 *
 * THE TOKEN IS SHOWN EXACTLY ONCE, and that is the decision worth pinning.
 * `generate` is the only answer that carries the plaintext — the list answers
 * metadata and never a secret — so a page that dropped the minted value on the
 * floor would leave the customer with a token nothing can recover and a
 * provisioning integration they cannot finish. The list never shows one, which
 * is the other half of the same guarantee.
 *
 * Spec: specs/settings/settings-page-chrome.feature
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    rows: [] as Array<Record<string, unknown>>,
    minted: { token: "scim_live_secret_value" },
  },
  calls: { generate: vi.fn(), revoke: vi.fn(), invalidate: vi.fn() },
}));

vi.mock("../../../behavior/scim-api", () => ({
  scimApi: {
    useUtils: () => ({ scimToken: { list: { invalidate: calls.invalidate } } }),
    scimToken: {
      list: { useQuery: () => ({ data: state.rows, isLoading: false }) },
      generate: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: unknown,
            options?: { onSuccess?: (result: { token: string }) => void },
          ) => {
            calls.generate(input);
            options?.onSuccess?.(state.minted);
          },
        }),
      },
      revoke: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            calls.revoke(input);
            options?.onSuccess?.();
          },
        }),
      },
    },
  },
}));

import { FakeScimHost, renderWithScimHost } from "../../../testing";
import ScimScreen from "../scim.screen";

const token = (overrides: Record<string, unknown> = {}) => ({
  id: "token-1",
  description: "Okta SCIM integration",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  lastUsedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.minted = { token: "scim_live_secret_value" };
});

afterEach(cleanup);

describe("given no organization is in scope", () => {
  it("renders nothing rather than a page about nothing", () => {
    const { container } = renderWithScimHost(
      <ScimScreen />,
      new FakeScimHost({ organizationId: null }),
    );

    expect(container.textContent).toBe("");
  });
});

describe("given the identity provider has to be pointed somewhere", () => {
  it("shows the base URL this deployment answers on", () => {
    renderWithScimHost(
      <ScimScreen />,
      new FakeScimHost({ scimBaseUrl: "https://acme.langwatch.test/api/scim/v2" }),
    );

    expect(screen.getByDisplayValue("https://acme.langwatch.test/api/scim/v2")).toBeTruthy();
  });
});

describe("given no token has been generated yet", () => {
  it("says so instead of leaving an empty table", () => {
    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText(/no scim tokens yet/i)).toBeTruthy();
  });
});

describe("given tokens exist", () => {
  it("lists their metadata and never a secret", () => {
    state.rows = [token()];

    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText("Okta SCIM integration")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.queryByDisplayValue("scim_live_secret_value")).toBeNull();
  });
});

describe("when a token is generated", () => {
  it("shows the minted value, which nothing can recover afterwards", async () => {
    renderWithScimHost(<ScimScreen />);

    fireEvent.click(screen.getByRole("button", { name: /generate token/i }));
    // The dialog mounts in a portal a tick later, so its own submit is the
    // second button by this name rather than the one that opened it.
    // The dialog mounts in a portal on a later tick, so its own submit is the
    // second button by this name rather than the one that opened it.
    const submit = await waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: /generate token/i });
      if (buttons.length < 2) throw new Error("the dialog has not mounted yet");
      return buttons[buttons.length - 1]!;
    });
    fireEvent.click(submit);

    expect(calls.generate).toHaveBeenCalledWith({
      organizationId: "org-1",
      description: void 0,
    });
    expect(await screen.findByDisplayValue("scim_live_secret_value")).toBeTruthy();
  });
});
