/**
 * @vitest-environment jsdom
 *
 * The ground under the auth screens, at its stillest. Under reduced motion
 * the shader never runs — and, as of the regression this pins, the machine
 * is never even ASKED whether it could run one: `canvas.getContext("webgl")`
 * goes through a software rasterizer on GPU-less machines (CI, VMs) that
 * takes whole seconds to initialise, which turned every signed-out page view
 * into a stall on exactly the machines that ask for stillness.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGround } from "../AuthGround";

/** Points `prefers-reduced-motion: reduce` at the given answer. A fresh
 *  function identity each call, because `useReducedMotion` caches its
 *  MediaQueryList keyed on `window.matchMedia` itself. */
function stubReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const renderGround = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AuthGround />
    </ChakraProvider>,
  );

describe("given less motion has been asked for", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when the ground renders", () => {
    /** @scenario "A door asked to hold still never warms up a graphics engine" */
    it("keeps the still colour field and never probes for shader support", () => {
      stubReducedMotion(true);
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

      const { container } = renderGround();

      expect(container.querySelector(".lw-auth-ambient-static")).not.toBeNull();
      expect(container.querySelector(".lw-auth-shader-arrive")).toBeNull();
      expect(getContext).not.toHaveBeenCalled();
    });
  });
});

describe("given motion is allowed", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when the ground renders", () => {
    it("asks the machine for shader support exactly once", () => {
      stubReducedMotion(false);
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

      const { container } = renderGround();

      // jsdom has no WebGL, so the probe answers no and the static field
      // stays — but the QUESTION was asked, which is the complement that
      // keeps the reduced-motion assertion above meaningful.
      expect(getContext).toHaveBeenCalled();
      expect(container.querySelector(".lw-auth-ambient-static")).not.toBeNull();
    });
  });
});
