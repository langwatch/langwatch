/**
 * @vitest-environment jsdom
 *
 * See ADR-058 and specs/ui/browser-errors.feature.
 */
import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ATTR_BROWSER_ERROR_SOURCE,
  BROWSER_ERROR_MAX_LENGTH,
  BROWSER_ERROR_MAX_PER_WINDOW,
  BROWSER_ERROR_WINDOW_MS,
  createErrorGate,
  describeErrorValue,
  sanitiseErrorMessage,
  sanitiseStack,
  startBrowserErrorCapture,
} from "./browserErrors.ts";

describe("the browser error gate", () => {
  describe("given the same message arrives repeatedly", () => {
    /** @scenario A console error reaches the backend once per minute per message */
    it("admits it once per minute and again in the next", () => {
      let at = 1_000_000;
      const gate = createErrorGate({ now: () => at });

      expect(gate.admit({ message: "boom" })).toBe(true);
      at += BROWSER_ERROR_WINDOW_MS - 1;
      expect(gate.admit({ message: "boom" })).toBe(false);
      expect(gate.admit({ message: "other" })).toBe(true);
      at += 1;
      expect(gate.admit({ message: "boom" })).toBe(true);
    });

    /** @scenario A console error reaches the backend once per minute per message */
    it("caps distinct messages per minute", () => {
      const gate = createErrorGate({ now: () => 1_000_000 });
      const admitted = Array.from({ length: BROWSER_ERROR_MAX_PER_WINDOW + 5 }, (_, index) =>
        gate.admit({ message: `m${index}` }),
      ).filter(Boolean);

      expect(admitted).toHaveLength(BROWSER_ERROR_MAX_PER_WINDOW);
    });
  });
});

describe("sanitiseErrorMessage", () => {
  /** @scenario Query strings and long messages are stripped */
  it("strips query strings and fragments from absolute and relative URLs", () => {
    const message = sanitiseErrorMessage({
      message: "GET https://app.test/api/x?session=abc&q=1 failed at /traces?filter=secret#top",
    });

    expect(message).toBe("GET https://app.test/api/x failed at /traces");
  });

  /** @scenario Query strings and long messages are stripped */
  it("redacts bearer tokens and credential-looking pairs", () => {
    const message = sanitiseErrorMessage({
      message: "Bearer abc.def.ghi rejected; password=hunter2 api_key: sk-123",
    });

    expect(message).not.toMatch(/abc\.def|hunter2|sk-123/);
  });

  /** @scenario Query strings and long messages are stripped */
  it.each([
    ["a long base64 run", "failed QWxhZGRpbjpvcGVuIHNlc2FtZVF3ZXJ0eQ== here", /QWxhZGRpbjpv/],
    ["a long hex run", "id 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822c", /9f86d081884c/],
    ["an sk- prefix", "using sk-abcd1234 now", /sk-abcd/],
    ["a pat- prefix", "using pat-ab12cd34 now", /pat-ab12/],
    ["a JWT shape", "got eyJhbGciOi.eyJzdWIiOiIx.c2ln back", /eyJhbGci/],
    ["URL userinfo", "GET https://user:pw0rd@app.test/x failed", /user:pw0rd/],
    ["an email", "no account for jane.doe@example.com", /jane\.doe/],
    ["a JSON secret key", '{"api_key":"abc def","ok":1}', /abc def/],
    ["a JSON token key", '{"accessToken": "short"}', /short/],
    ["a JSON password key", `{'password': 'p w'}`, /p w/],
    ["a JSON cookie key", '{"cookie":"a=b"}', /a=b/],
  ])("redacts %s", (_label, message, leaked) => {
    expect(sanitiseErrorMessage({ message })).not.toMatch(leaked);
  });

  /** @scenario Query strings and long messages are stripped */
  it("keeps ordinary text readable", () => {
    expect(sanitiseErrorMessage({ message: "TypeError: x is not a function" })).toBe(
      "TypeError: x is not a function",
    );
  });

  /** @scenario Query strings and long messages are stripped */
  it("keeps only file:line frames of a stack", () => {
    const stack = [
      "Error: boom jane@example.com",
      "    at render (https://app.test/assets/main-abc.js?v=secret:12:34)",
      "    at https://app.test/assets/vendor.js:5:6",
      "run@https://app.test/assets/other.js:7:8",
    ].join("\n");

    expect(sanitiseStack({ stack })).toBe("main-abc.js:12\nvendor.js:5\nother.js:7");
    expect(sanitiseStack({ stack: undefined })).toBe("");
  });

  /** @scenario Query strings and long messages are stripped */
  it("caps the length", () => {
    expect(sanitiseErrorMessage({ message: "word ".repeat(1_000) })).toHaveLength(
      BROWSER_ERROR_MAX_LENGTH,
    );
  });

  /** @scenario Query strings and long messages are stripped */
  it("names objects by type instead of printing their contents", () => {
    expect(describeErrorValue({ value: { password: "hunter2" } })).toBe("[object]");
    expect(describeErrorValue({ value: new TypeError("bad") })).toBe("TypeError: bad");
  });
});

describe("startBrowserErrorCapture", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new WebTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const original = console.error;
  const swallowed: unknown[][] = [];

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    console.error = (...args: unknown[]) => void swallowed.push(args);
    startBrowserErrorCapture();
  });

  afterAll(() => {
    console.error = original;
    trace.disable();
  });

  /** @scenario A console error reaches the backend once per minute per message */
  it("keeps calling the original and exports one span for a repeated console error", () => {
    console.error("render failed at /p?token=abc");
    console.error("render failed at /p?token=abc");

    expect(swallowed).toHaveLength(2);
    const spans = exporter.getFinishedSpans().filter((span) => span.name === "browser.error");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.attributes["exception.message"]).toBe("render failed at /p");
    expect(spans[0]?.attributes[ATTR_BROWSER_ERROR_SOURCE]).toBe("console");
  });

  /** @scenario Query strings and long messages are stripped */
  it("exports an Error's name, scrubbed message and file:line frames", () => {
    const error = new RangeError("bad jane@example.com");
    error.stack = "RangeError: bad\n    at f (https://app.test/a.js?x=1:3:4)";
    console.error(error);

    const span = exporter
      .getFinishedSpans()
      .find((candidate) =>
        String(candidate.attributes["exception.message"]).startsWith("RangeError"),
      );
    expect(span?.attributes["exception.message"]).toBe("RangeError: bad [email]");
    expect(span?.attributes["exception.stacktrace"]).toBe("a.js:3");
  });
});
