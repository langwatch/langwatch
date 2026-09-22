/**
 * @vitest-environment jsdom
 * Testing a connection as somebody who is not you: what the button copies,
 * and what it says when the browser will not let it copy anything.
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { TestFromAnotherBrowser } from "../test-from-another-browser.tsx";

const toasts = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@langwatch/design-system/toaster", () => ({ toaster: toasts }));

/** The page an administrator is standing on when they ask. */
const PATH = "/settings/authentication?manage=connection";

const clipboardOf = (writeText: () => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
};

describe("given an administrator who wants to test as another person", () => {
  beforeEach(() => {
    toasts.create.mockClear();
    // Driven through history rather than by replacing `location`, which jsdom
    // refuses to let a test redefine.
    window.history.replaceState({}, "", PATH);
  });
  afterEach(cleanup);

  /** @scenario "Testing from another browser copies the page, never the sign-in" */
  it("copies the page they are on rather than the sign-in", async () => {
    const writeText = vi.fn().mockResolvedValue(void 0);
    clipboardOf(writeText);
    renderWithSsoHost(<TestFromAnotherBrowser />);

    await userEvent.click(screen.getByRole("button", { name: /test from another browser/i }));

    // NOT the authorization address: a copied sign-in carries the state and
    // leaves the signed cookie behind, so the callback refuses every time.
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(writeText.mock.calls[0]?.[0]).toContain(PATH);
  });

  /** @scenario "Testing from another browser copies the page, never the sign-in" */
  it("says the sign-in has to start in the browser that finishes it", () => {
    const { container } = renderWithSsoHost(<TestFromAnotherBrowser />);

    expect(container.textContent).toContain("has to start in the browser that finishes it");
  });

  /** @scenario "Testing from another browser copies the page, never the sign-in" */
  it("points at the address bar when the browser refuses the clipboard", async () => {
    clipboardOf(vi.fn().mockRejectedValue(new Error("denied")));
    renderWithSsoHost(<TestFromAnotherBrowser />);

    await userEvent.click(screen.getByRole("button", { name: /test from another browser/i }));

    expect(toasts.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("address bar") }),
    );
  });
});
