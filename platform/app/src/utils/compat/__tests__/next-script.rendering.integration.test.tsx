/**
 * @vitest-environment jsdom
 *
 * Covers what Script puts on the injected <script> element — src/async/
 * onload/onerror wiring, inline content, id, and attribute pass-through.
 * Renders the real component tree via @testing-library/react, so this is
 * an integration test.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Script from "../next-script";

function getScript(id: string): HTMLScriptElement | null {
  return document.getElementById(id) as HTMLScriptElement | null;
}

describe("Script - rendered output", () => {
  beforeEach(() => {
    document.querySelectorAll("script").forEach((node) => node.remove());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  describe("given inline children", () => {
    it("sets textContent from string children", () => {
      render(
        <Script id="inline" strategy="beforeInteractive">
          {`window.__critical = true;`}
        </Script>,
      );

      expect(getScript("inline")?.textContent).toBe(
        `window.__critical = true;`,
      );
    });

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
});
