/**
 * specs/auth/impersonation-banner.feature: the banner ops lends to the header.
 * @vitest-environment jsdom
 */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { ADMIN_PANEL_PATH, ImpersonationHeaderBanner } from "../impersonation-header-banner.tsx";

const { hardRedirect, failed } = vi.hoisted(() => ({ hardRedirect: vi.fn(), failed: vi.fn() }));
vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiCapabilities: () => ({ feedback: { failed } }),
}));
vi.mock("../../../../behavior/hard-redirect.ts", () => ({ hardRedirect }));

const TARGET = { name: "Target User", email: "target@test.com" };
const IMPERSONATED = { ...TARGET, impersonator: { id: "admin_1", email: "admin@test.com" } };

function renderBanner(user: typeof TARGET | typeof IMPERSONATED) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <ImpersonationHeaderBanner user={user} />
    </DesignSystemProvider>,
  );
}

describe("the header's impersonation banner", () => {
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    hardRedirect.mockReset();
    failed.mockReset();
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
  });

  afterEach(() => {
    fetchMock.mockRestore();
    cleanup();
  });

  /** @scenario An impersonation banner appears in the header */
  it("names the person being impersonated and offers to stop", () => {
    renderBanner(IMPERSONATED);
    expect(screen.getByText("Impersonating Target User")).not.toBeNull();
    expect(screen.getAllByRole("link", { name: "Stop" }).length).toBeGreaterThan(0);
  });

  /** @scenario Impersonation banner does not appear for normal sessions */
  it("draws nothing for a session that is not impersonating", () => {
    renderBanner(TARGET);
    expect(screen.queryByText(/Impersonating/)).toBeNull();
  });

  /** @scenario Clicking stop ends impersonation */
  it("ends the impersonation on the server, then reloads onto the admin panel", async () => {
    renderBanner(IMPERSONATED);
    fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

    await waitFor(() => expect(hardRedirect).toHaveBeenCalledWith(ADMIN_PANEL_PATH));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/impersonate");
    expect(init?.method).toBe("DELETE");
  });

  it("stays put and says so when the server refuses to end it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "no" }), { status: 500 }));
    renderBanner(IMPERSONATED);
    fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(failed.mock.calls[0]?.[0]).toMatchObject({
      fallbackTitle: "Couldn't stop impersonating",
    });
    expect(hardRedirect).not.toHaveBeenCalled();
  });
});
