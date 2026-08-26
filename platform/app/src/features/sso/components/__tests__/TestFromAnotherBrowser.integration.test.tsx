/**
 * @vitest-environment jsdom
 *
 * Testing a connection as somebody who is not you.
 *
 * Spec: specs/identity/sso-activation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("~/components/ui/toaster", () => ({ toaster: toasts }));

const { TestFromAnotherBrowser } = await import("../TestFromAnotherBrowser");

/** The page an administrator is standing on when they ask. */
const PATH = "/settings/authentication?manage=connection";

function draw() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TestFromAnotherBrowser />
    </ChakraProvider>,
  );
}

describe("given an administrator who wants to test as another person", () => {
  beforeEach(() => {
    toasts.create.mockClear();
    // Driven through history rather than by replacing `location`, which jsdom
    // refuses to let a test redefine.
    window.history.replaceState({}, "", PATH);
  });
  afterEach(() => cleanup());

  describe("when they ask to test from another browser", () => {
    /** @scenario Testing from another browser copies the page, never the sign-in */
    it("copies the page they are on rather than the sign-in", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      await userEvent.click(
        draw().getByRole("button", { name: /test from another browser/i }),
      );

      // NOT the authorization URL: starting a sign-in leaves a signed state
      // cookie on the browser that asked, and the callback refuses when the
      // address and the cookie disagree. A copied sign-in link carries the
      // state and leaves the cookie behind, so it fails every time.
      expect(writeText).toHaveBeenCalledWith(window.location.href);
      expect(writeText.mock.calls[0]?.[0]).toContain(PATH);
    });

    /** @scenario Testing from another browser copies the page, never the sign-in */
    it("says the sign-in has to start in the browser that finishes it", () => {
      const { container } = draw();

      expect(container.textContent).toContain(
        "has to start in the browser that finishes it",
      );
    });
  });

  describe("when the browser refuses the clipboard", () => {
    /** @scenario Testing from another browser copies the page, never the sign-in */
    it("points at the address bar rather than apologising", async () => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      });

      await userEvent.click(
        draw().getByRole("button", { name: /test from another browser/i }),
      );

      expect(toasts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("address bar"),
        }),
      );
    });
  });
});
