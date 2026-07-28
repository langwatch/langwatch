/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  classifyEngineFailure,
  classifyHttpFailure,
  cleanErrorDetail,
  formatEngineError,
  formatFetchError,
  formatHttpError,
  parseErrorEnvelope,
  redactInternalAddresses,
} from "../format-execution-error";

/** Build the herr envelope the Go engine writes (`pkg/herr/http.go`). */
const herrBody = (type: string, message: string) =>
  JSON.stringify({ error: { type, message } });

describe("format-execution-error helpers (lw#3439)", () => {
  describe("cleanErrorDetail", () => {
    it("removes ANSI escape sequences", () => {
      const raw = "\x1b[31mred error\x1b[0m on line 1";
      expect(cleanErrorDetail(raw)).toBe("red error on line 1");
    });

    it("strips known AI SDK and OTEL noise lines", () => {
      const raw = [
        "AI SDK Warning (foo): bar",
        "Flushing OTEL traces...",
        "OTEL traces flushed",
        "ValueError: actual error",
      ].join("\n");
      const cleaned = cleanErrorDetail(raw);
      expect(cleaned).not.toMatch(/AI SDK Warning/);
      expect(cleaned).not.toMatch(/Flushing OTEL traces/);
      expect(cleaned).not.toMatch(/OTEL traces flushed/);
      expect(cleaned).toMatch(/ValueError: actual error/);
    });

    it("collapses consecutive blank lines left behind by stripped noise", () => {
      const raw = "line a\n\n\n\nline b";
      expect(cleanErrorDetail(raw)).toBe("line a\n\nline b");
    });

    it("collapses the two-line gap a stripped noise block leaves mid-traceback", () => {
      const raw = [
        "Traceback (most recent call last):",
        "AI SDK Warning (foo): bar",
        "Flushing OTEL traces...",
        "ValueError: actual error",
      ].join("\n");
      expect(cleanErrorDetail(raw)).toBe(
        "Traceback (most recent call last):\n\nValueError: actual error",
      );
    });

    it("truncates very long inputs and includes a marker referencing the original length", () => {
      const raw = "x".repeat(5_000);
      const cleaned = cleanErrorDetail(raw);
      expect(cleaned.length).toBeLessThan(raw.length);
      expect(cleaned).toMatch(/truncated, original was 5000 chars/);
    });

    it("does not name an internal field the customer cannot reach", () => {
      expect(cleanErrorDetail("x".repeat(5_000))).not.toMatch(/rawDetail/);
    });
  });

  describe("parseErrorEnvelope", () => {
    it("reads the herr envelope the Go engine writes", () => {
      const out = parseErrorEnvelope(herrBody("bad_request", "engine blew up"));
      expect(out.code).toBe("bad_request");
      expect(out.detail).toBe("engine blew up");
      expect(out.legacyDetail).toBe(false);
    });

    it("reads the legacy detail envelope as a fallback", () => {
      const out = parseErrorEnvelope(JSON.stringify({ detail: "boom" }));
      expect(out.code).toBeUndefined();
      expect(out.detail).toBe("boom");
      expect(out.legacyDetail).toBe(true);
    });

    it("stringifies a non-string detail rather than passing it through", () => {
      const out = parseErrorEnvelope(
        JSON.stringify({ detail: [{ msg: "field required" }] }),
      );
      expect(out.detail).toMatch(/field required/);
      expect(typeof out.detail).toBe("string");
    });

    it("treats an unparseable body as opaque", () => {
      const out = parseErrorEnvelope("<html>500</html>");
      expect(out.code).toBeUndefined();
      expect(out.detail).toBeUndefined();
      expect(out.legacyDetail).toBe(false);
    });
  });

  describe("classifyEngineFailure", () => {
    it("classifies a Python exception class as user_code", () => {
      expect(classifyEngineFailure({ errorType: "AttributeError" })).toBe(
        "user_code",
      );
    });

    it("classifies an engine_error as nlp_service", () => {
      expect(classifyEngineFailure({ errorType: "engine_error" })).toBe(
        "nlp_service",
      );
    });

    it("defaults an unrecognised type to user_code, not infra", () => {
      // The workflow is one code node, so anything the engine does not own is
      // the customer's code. Defaulting the other way is the lw#3439 inversion.
      expect(classifyEngineFailure({ errorType: "SomeNewPythonError" })).toBe(
        "user_code",
      );
    });
  });

  describe("classifyHttpFailure", () => {
    it("classifies a customer-fault herr code as user_code", () => {
      expect(
        classifyHttpFailure({
          status: 400,
          envelope: parseErrorEnvelope(herrBody("bad_request", "x")),
        }),
      ).toBe("user_code");
    });

    it("classifies a platform-fault herr code as nlp_service", () => {
      expect(
        classifyHttpFailure({
          status: 500,
          envelope: parseErrorEnvelope(herrBody("internal_error", "x")),
        }),
      ).toBe("nlp_service");
    });

    it("does not blame user code for a rejected credential", () => {
      // `unauthorized` is a customer fault to the Go engine, but on this path
      // the adapter supplies the API key — the customer never sees it.
      expect(
        classifyHttpFailure({
          status: 401,
          envelope: parseErrorEnvelope(herrBody("unauthorized", "bad key")),
        }),
      ).toBe("nlp_service");
    });

    it("classifies a legacy 500 with a detail as user_code", () => {
      expect(
        classifyHttpFailure({
          status: 500,
          envelope: parseErrorEnvelope(
            JSON.stringify({ detail: "ValueError: x" }),
          ),
        }),
      ).toBe("user_code");
    });

    it("classifies an opaque 500 as nlp_service", () => {
      expect(
        classifyHttpFailure({
          status: 500,
          envelope: parseErrorEnvelope("<html>500</html>"),
        }),
      ).toBe("nlp_service");
    });
  });

  describe("formatEngineError", () => {
    it("formats a user-code failure from the engine traceback", () => {
      const out = formatEngineError({
        engineError: {
          type: "ValueError",
          message: "bad input",
          traceback: "Traceback...\nValueError: bad input",
        },
      });
      expect(out.source).toBe("user_code");
      expect(out.message).toMatch(/user code raised an error/);
      expect(out.message).toMatch(/type: ValueError/);
      expect(out.message).toMatch(/ValueError: bad input/);
      expect(out.rawDetail).toMatch(/Traceback/);
    });

    it("falls back to the engine message when no traceback is present", () => {
      const out = formatEngineError({
        engineError: { type: "AttributeError", message: "no attribute ABSENT" },
      });
      expect(out.rawDetail).toBe("no attribute ABSENT");
      expect(out.message).toMatch(/no attribute ABSENT/);
    });

    it("formats an engine_error as an infra failure", () => {
      const out = formatEngineError({
        engineError: { type: "engine_error", message: "nil deref" },
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).toMatch(
        /NLP service failed while running the workflow/,
      );
      expect(out.message).not.toMatch(/user code raised/);
    });
  });

  describe("formatHttpError", () => {
    it("formats a customer-fault herr envelope as a user-code failure", () => {
      const out = formatHttpError({
        status: 400,
        rawBody: herrBody("bad_request", "ValueError: x"),
      });
      expect(out.source).toBe("user_code");
      expect(out.message).toMatch(/user code raised an error/);
      expect(out.message).toMatch(/status: 400/);
      expect(out.message).toMatch(/ValueError: x/);
    });

    it("formats a 503 as an infra failure", () => {
      const out = formatHttpError({
        status: 503,
        rawBody: herrBody("child_unavailable", "service down"),
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).toMatch(/NLP service returned HTTP 503/);
      expect(out.message).toMatch(/service down/);
    });

    it("renders an opaque body verbatim instead of dropping it", () => {
      const out = formatHttpError({
        status: 500,
        rawBody: "<html>500</html>",
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).toMatch(/NLP service returned HTTP 500/);
      expect(out.message).toMatch(/<html>500<\/html>/);
    });

    it("renders an empty body marker when no body is available", () => {
      const out = formatHttpError({ status: 502, rawBody: "" });
      expect(out.message).toMatch(/\(empty\)/);
    });

    it("does not crash on a non-string detail", () => {
      const out = formatHttpError({
        status: 500,
        rawBody: JSON.stringify({ detail: [{ msg: "field required" }] }),
      });
      expect(out.message).toMatch(/field required/);
    });

    it("never leaks an internal endpoint into the surfaced message", () => {
      const userCode = formatHttpError({
        status: 400,
        rawBody: herrBody("bad_request", "boom"),
      });
      const infra = formatHttpError({
        status: 503,
        rawBody: herrBody("child_unavailable", "down"),
      });
      expect(userCode.message).not.toMatch(/execute_sync|https?:\/\//);
      expect(infra.message).not.toMatch(/execute_sync|https?:\/\//);
    });

    it("returns a source that always agrees with the message wording", () => {
      const userCode = formatHttpError({
        status: 400,
        rawBody: herrBody("bad_request", "ValueError: x"),
      });
      expect(userCode.source).toBe("user_code");
      expect(userCode.message).toMatch(/user code raised an error/);

      const infra500 = formatHttpError({ status: 500, rawBody: "<html>" });
      expect(infra500.source).toBe("nlp_service");
      expect(infra500.message).toMatch(/NLP service returned HTTP 500/);

      const infra503 = formatHttpError({
        status: 503,
        rawBody: herrBody("child_unavailable", "down"),
      });
      expect(infra503.source).toBe("nlp_service");
      expect(infra503.message).toMatch(/NLP service returned HTTP 503/);
    });
  });

  describe("formatFetchError", () => {
    it("formats a timeout with the configured ms", () => {
      const out = formatFetchError({
        cause: new Error("aborted"),
        timedOutAfterMs: 120_000,
      });
      expect(out).toMatch(/did not respond within 120000ms/);
    });

    it("does not leak an internal endpoint into the timeout message", () => {
      const out = formatFetchError({
        cause: new Error("aborted"),
        timedOutAfterMs: 120_000,
      });
      expect(out).not.toMatch(/execute_sync|https?:\/\//);
    });

    it("formats a generic fetch failure with cause and inner cause", () => {
      const innerCause = new Error("ENOTFOUND");
      const outer = new Error("fetch failed", { cause: innerCause });
      const out = formatFetchError({ cause: outer });
      expect(out).toMatch(/failed to reach NLP service/);
      expect(out).toMatch(/cause: fetch failed/);
      expect(out).toMatch(/cause: Error: ENOTFOUND/);
    });

    it("reduces an undici connect failure to its code, dropping the address", () => {
      // The cause undici actually attaches. Without redaction the internal
      // host:port lands in the message persisted on the run record.
      const inner = Object.assign(
        new Error("connect ECONNREFUSED 10.4.2.11:5561"),
        { code: "ECONNREFUSED" },
      );
      const out = formatFetchError({
        cause: new TypeError("fetch failed", { cause: inner }),
      });
      expect(out).toMatch(/ECONNREFUSED/);
      expect(out).not.toMatch(/10\.4\.2\.11/);
      expect(out).not.toMatch(/5561/);
    });

    it("redacts an internal hostname carrying a port", () => {
      const inner = new Error("getaddrinfo ENOTFOUND nlp-internal:5561");
      const out = formatFetchError({
        cause: new TypeError("fetch failed", { cause: inner }),
      });
      expect(out).not.toMatch(/nlp-internal/);
    });
  });

  describe("redactInternalAddresses", () => {
    it("removes an ipv4 address and port", () => {
      expect(redactInternalAddresses("connect to 10.4.2.11:5561")).not.toMatch(
        /10\.4\.2\.11|5561/,
      );
    });

    it("removes an absolute url", () => {
      expect(
        redactInternalAddresses("posting to http://nlp-internal:5561/go/x"),
      ).not.toMatch(/nlp-internal/);
    });
  });
});
