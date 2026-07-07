/**
 * @vitest-environment jsdom
 *
 * Covers correctness under React StrictMode's dev-only
 * setup→cleanup→setup effect cycle: the script must inject exactly once,
 * for both the synchronous (beforeInteractive) and deferred (idle-based)
 * paths. Renders the real component tree via @testing-library/react, so
 * this is an integration test.
 */
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Script from "../next-script";

describe("Script - React StrictMode double-invoked effects", () => {
  beforeEach(() => {
    document.querySelectorAll("script").forEach((node) => node.remove());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("given strategy='beforeInteractive'", () => {
    it("injects the script only once, not twice", () => {
      render(
        <StrictMode>
          <Script id="strict-sync" strategy="beforeInteractive">
            {`1;`}
          </Script>
        </StrictMode>,
      );

      expect(document.querySelectorAll("#strict-sync").length).toBe(1);
    });
  });

  describe("given a deferred strategy (afterInteractive)", () => {
    it("still injects the script exactly once after the synthetic cleanup/remount cycle", () => {
      // StrictMode's dev-only cycle cancels the pending idle callback on
      // the synthetic "cleanup" between the two effect invocations, then
      // re-runs the effect. If the "already injected" guard were set at
      // schedule time instead of at actual-injection time, that remount
      // would see the guard already tripped and never reschedule — the
      // script would silently never inject under StrictMode.
      let idleCallback: (() => void) | undefined;
      vi.stubGlobal(
        "requestIdleCallback",
        vi.fn((cb: () => void) => {
          idleCallback = cb;
          return 1;
        }),
      );

      render(
        <StrictMode>
          <Script id="strict-deferred" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];`}
          </Script>
        </StrictMode>,
      );

      idleCallback?.();

      expect(document.querySelectorAll("#strict-deferred").length).toBe(1);
    });
  });
});
