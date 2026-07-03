/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Script from "../next-script";

function getScript(id: string): HTMLScriptElement | null {
  return document.getElementById(id) as HTMLScriptElement | null;
}

describe("Script", () => {
  beforeEach(() => {
    document.querySelectorAll("script[id]").forEach((node) => node.remove());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

    it("sets the inline script's textContent from string children", () => {
      render(
        <Script id="critical" strategy="beforeInteractive">
          {`window.__critical = true;`}
        </Script>,
      );

      expect(getScript("critical")?.textContent).toBe(
        `window.__critical = true;`,
      );
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

          vi.useRealTimers();
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

          vi.useRealTimers();
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

          vi.useRealTimers();
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

  describe("given a src prop (external script)", () => {
    it("sets src and async on the injected script", () => {
      render(
        <Script
          id="ext"
          src="https://example.com/a.js"
          strategy="beforeInteractive"
        />,
      );

      const script = getScript("ext");
      expect(script?.src).toBe("https://example.com/a.js");
      expect(script?.async).toBe(true);
    });

    it("does not set textContent even if children are also passed", () => {
      render(
        <Script
          id="ext"
          src="https://example.com/a.js"
          strategy="beforeInteractive"
        >
          {`should be ignored`}
        </Script>,
      );

      expect(getScript("ext")?.textContent).toBe("");
    });

    it("wires onload to the onLoad prop when provided", () => {
      const onLoad = vi.fn();
      render(
        <Script
          id="ext"
          src="https://example.com/a.js"
          strategy="beforeInteractive"
          onLoad={onLoad}
        />,
      );

      const script = getScript("ext")!;
      script.onload?.(new Event("load"));

      expect(onLoad).toHaveBeenCalledTimes(1);
    });

    it("does not set onload when onLoad is not provided", () => {
      render(
        <Script
          id="ext"
          src="https://example.com/a.js"
          strategy="beforeInteractive"
        />,
      );

      expect(getScript("ext")?.onload).toBeNull();
    });

    it("wires onerror to the onError prop when provided", () => {
      const onError = vi.fn();
      render(
        <Script
          id="ext"
          src="https://example.com/a.js"
          strategy="beforeInteractive"
          onError={onError}
        />,
      );

      const script = getScript("ext")!;
      script.onerror?.(new Event("error"));

      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("does not set onerror when onError is not provided", () => {
      render(
        <Script
          id="ext"
          src="https://example.com/a.js"
          strategy="beforeInteractive"
        />,
      );

      expect(getScript("ext")?.onerror).toBeNull();
    });
  });

  describe("given children that are not a plain string", () => {
    it("does not set textContent for undefined children", () => {
      render(<Script id="no-children" strategy="beforeInteractive" />);

      expect(getScript("no-children")?.textContent).toBe("");
    });

    it("does not set textContent for JSX children", () => {
      render(
        <Script id="jsx-children" strategy="beforeInteractive">
          <span>not a string</span>
        </Script>,
      );

      expect(getScript("jsx-children")?.textContent).toBe("");
    });
  });

  describe("given no id", () => {
    it("injects the script without setting an id attribute", () => {
      const before = document.head.querySelectorAll("script").length;
      render(<Script strategy="beforeInteractive">{`1;`}</Script>);
      const after = document.head.querySelectorAll("script");

      expect(after.length).toBe(before + 1);
      expect(after[after.length - 1]!.id).toBe("");
    });
  });

  describe("given extra attribute props", () => {
    it("sets them as attributes on the injected script", () => {
      render(
        <Script
          id="attrs"
          strategy="beforeInteractive"
          data-testid="third-party"
          crossOrigin="anonymous"
        >
          {`1;`}
        </Script>,
      );

      const script = getScript("attrs");
      expect(script?.getAttribute("data-testid")).toBe("third-party");
      expect(script?.getAttribute("crossOrigin")).toBe("anonymous");
    });

    it("excludes dangerouslySetInnerHTML from the attributes applied", () => {
      render(
        <Script
          id="dsih"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: "should not appear" }}
        >
          {`1;`}
        </Script>,
      );

      expect(getScript("dsih")?.getAttribute("dangerouslySetInnerHTML")).toBe(
        null,
      );
    });
  });

  describe("given React StrictMode double-invokes effects", () => {
    it("injects the script only once, not twice", () => {
      vi.stubGlobal(
        "requestIdleCallback",
        vi.fn(() => 1),
      );

      render(
        <StrictMode>
          <Script id="strict" strategy="beforeInteractive">
            {`1;`}
          </Script>
        </StrictMode>,
      );

      expect(document.querySelectorAll("#strict").length).toBe(1);
    });
  });
});
