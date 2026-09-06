/**
 * @vitest-environment jsdom
 *
 * Covers when Script injects its <script> tag relative to strategy,
 * idle-callback availability, and unmount. Renders the real component tree
 * via @testing-library/react, so this is an integration test.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Script from "../next-script";

function getScript(id: string): HTMLScriptElement | null {
  return document.getElementById(id) as HTMLScriptElement | null;
}

describe("Script - injection timing", () => {
  beforeEach(() => {
    document.querySelectorAll("script").forEach((node) => node.remove());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("given strategy='beforeInteractive'", () => {
    it("injects the script synchronously on mount", () => {
      render(
        <Script id="critical" strategy="beforeInteractive">
          {`window.__critical = true;`}
        </Script>,
      );

      expect(getScript("critical")).not.toBeNull();
    });
  });

  describe("given strategy='afterInteractive'", () => {
    describe("when requestIdleCallback is available", () => {
      it("does not inject before the idle callback fires", () => {
        vi.stubGlobal(
          "requestIdleCallback",
          vi.fn(() => 1),
        );

        render(
          <Script id="gtm-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];`}
          </Script>,
        );

        expect(getScript("gtm-init")).toBeNull();
      });

      it("injects once the idle callback fires", () => {
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

        idleCallback?.();

        expect(getScript("gtm-init")).not.toBeNull();
      });

      it("passes a timeout so the callback can't wait forever", () => {
        const requestIdleCallback = vi.fn(() => 1);
        vi.stubGlobal("requestIdleCallback", requestIdleCallback);

        render(<Script id="gtm-init">{`1;`}</Script>);

        expect(requestIdleCallback).toHaveBeenCalledWith(
          expect.any(Function),
          expect.objectContaining({ timeout: expect.any(Number) }),
        );
      });

      describe("when the component unmounts before the idle callback fires", () => {
        it("cancels the pending idle callback via cancelIdleCallback", () => {
          let idleCallback: (() => void) | undefined;
          const cancelIdleCallback = vi.fn();
          vi.stubGlobal(
            "requestIdleCallback",
            vi.fn((cb: () => void) => {
              idleCallback = cb;
              return 42;
            }),
          );
          vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);

          const { unmount } = render(
            <Script id="gtm-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];`}
            </Script>,
          );

          unmount();

          expect(cancelIdleCallback).toHaveBeenCalledWith(42);

          // Even if something still invokes the stale callback, the
          // cancelled-flag guard must stop it from injecting.
          idleCallback?.();

          expect(getScript("gtm-init")).toBeNull();
        });

        it("does not throw when cancelIdleCallback is unavailable", () => {
          let idleCallback: (() => void) | undefined;
          vi.stubGlobal(
            "requestIdleCallback",
            vi.fn((cb: () => void) => {
              idleCallback = cb;
              return 1;
            }),
          );
          vi.stubGlobal("cancelIdleCallback", undefined);

          const { unmount } = render(
            <Script id="gtm-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];`}
            </Script>,
          );

          expect(() => unmount()).not.toThrow();

          idleCallback?.();

          expect(getScript("gtm-init")).toBeNull();
        });
      });
    });

    describe("when requestIdleCallback is unavailable (Safari)", () => {
      describe("when the document has already finished loading", () => {
        it("injects on the next tick without waiting for 'load'", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
          vi.useFakeTimers();

          render(<Script id="pendo">{`window.pendo = {};`}</Script>);

          expect(getScript("pendo")).toBeNull();

          vi.runAllTimers();

          expect(getScript("pendo")).not.toBeNull();
        });

        it("cancels the pending timeout if unmounted first", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
          vi.useFakeTimers();

          const { unmount } = render(
            <Script id="pendo">{`window.pendo = {};`}</Script>,
          );

          unmount();
          vi.runAllTimers();

          expect(getScript("pendo")).toBeNull();
        });
      });

      describe("when the document is still loading", () => {
        it("defers injection until window 'load' fires", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
          vi.useFakeTimers();

          render(<Script id="pendo">{`window.pendo = {};`}</Script>);

          expect(getScript("pendo")).toBeNull();

          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(getScript("pendo")).not.toBeNull();
        });

        it("only listens for 'load' once", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
          vi.useFakeTimers();

          render(<Script id="pendo">{`window.pendo = {};`}</Script>);

          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();
          const scriptCountAfterFirstLoad =
            document.querySelectorAll("#pendo").length;

          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(document.querySelectorAll("#pendo").length).toBe(
            scriptCountAfterFirstLoad,
          );
        });

        it("removes the pending 'load' listener if unmounted first", () => {
          vi.stubGlobal("requestIdleCallback", undefined);
          vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
          vi.useFakeTimers();

          const { unmount } = render(
            <Script id="pendo">{`window.pendo = {};`}</Script>,
          );

          unmount();
          window.dispatchEvent(new Event("load"));
          vi.runAllTimers();

          expect(getScript("pendo")).toBeNull();
        });
      });
    });
  });

  describe("given strategy='lazyOnload'", () => {
    it("also defers to idle rather than injecting eagerly", () => {
      vi.stubGlobal(
        "requestIdleCallback",
        vi.fn(() => 1),
      );

      render(<Script id="lazy-thing" strategy="lazyOnload">{`1;`}</Script>);

      expect(getScript("lazy-thing")).toBeNull();
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

      expect(getScript("crisp")).toBeNull();

      idleCallback?.();

      expect(getScript("crisp")).not.toBeNull();
    });
  });
});
