/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Script from "../next-script";

describe("Script", () => {
  beforeEach(() => {
    document.querySelectorAll("script[id]").forEach((node) => node.remove());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given strategy='beforeInteractive'", () => {
    it("injects the script synchronously on mount", () => {
      render(
        <Script id="critical" strategy="beforeInteractive">
          {`window.__critical = true;`}
        </Script>,
      );

      expect(document.getElementById("critical")).not.toBeNull();
    });
  });

  describe("given strategy='afterInteractive'", () => {
    describe("when requestIdleCallback is available", () => {
      it("defers injection until the idle callback fires", () => {
        let idleCallback: (() => void) | undefined;
        vi.stubGlobal(
          "requestIdleCallback",
          vi.fn((cb: () => void) => {
            idleCallback = cb;
            return 1;
          }),
        );

        render(
          <Script id="gtm-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];`}
          </Script>,
        );

        expect(document.getElementById("gtm-init")).toBeNull();

        idleCallback?.();

        expect(document.getElementById("gtm-init")).not.toBeNull();
      });
    });

    describe("when requestIdleCallback is unavailable (Safari)", () => {
      it("defers injection until window 'load' fires", () => {
        vi.stubGlobal("requestIdleCallback", undefined);
        vi.useFakeTimers();

        render(
          <Script id="pendo" strategy="afterInteractive">
            {`window.pendo = {};`}
          </Script>,
        );

        expect(document.getElementById("pendo")).toBeNull();

        window.dispatchEvent(new Event("load"));
        vi.runAllTimers();

        expect(document.getElementById("pendo")).not.toBeNull();

        vi.useRealTimers();
      });
    });
  });

  describe("given no strategy (e.g. Pendo/Crisp today)", () => {
    it("still defers to idle rather than injecting eagerly", () => {
      let idleCallback: (() => void) | undefined;
      vi.stubGlobal(
        "requestIdleCallback",
        vi.fn((cb: () => void) => {
          idleCallback = cb;
          return 1;
        }),
      );

      render(<Script id="crisp">{`window.$crisp = [];`}</Script>);

      expect(document.getElementById("crisp")).toBeNull();

      idleCallback?.();

      expect(document.getElementById("crisp")).not.toBeNull();
    });
  });
});
