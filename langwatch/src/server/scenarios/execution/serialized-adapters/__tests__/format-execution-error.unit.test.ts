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

    /** @scenario the surfaced traceback keeps the customer's frames and drops the engine's own */
    it("strips the engine's own harness frames but keeps the customer's", () => {
      // The engine anonymizes the customer frame to <code-block>; its wrapper
      // frames ride along in the same traceback and are both an internal
      // server path and noise the customer cannot act on.
      const raw = [
        "Traceback (most recent call last):",
        '  File "/tmp/nlpgo-codeblock-369240540/runner.py", line 143, in main',
        "    result = _invoke_user_entrypoint(module_globals, inputs)",
        "             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
        '  File "<code-block>", line 3, in execute',
        "httpx.TimeoutException: The read operation timed out",
      ].join("\n");
      const cleaned = cleanErrorDetail(raw);
      expect(cleaned).not.toMatch(/nlpgo-codeblock/);
      expect(cleaned).not.toMatch(/runner\.py/);
      expect(cleaned).not.toMatch(/_invoke_user_entrypoint/);
      expect(cleaned).toMatch(/<code-block>", line 3, in execute/);
      expect(cleaned).toMatch(/httpx\.TimeoutException/);
    });

    it("does not name an internal field the customer cannot reach", () => {
      expect(cleanErrorDetail("x".repeat(5_000))).not.toMatch(/rawDetail/);
    });

    it("counts the surviving detail in the truncation marker, not the noise it deleted", () => {
      // Reporting raw.length would tell a support engineer there are
      // thousands more characters of traceback to go find, when the formatter
      // itself deleted them as noise.
      const noise = "AI SDK Warning (foo): bar\n".repeat(200);
      const real = "y".repeat(2_500);
      const cleaned = cleanErrorDetail(noise + real);
      expect(cleaned).toMatch(/truncated, original was 2500 chars/);
      expect(cleaned).not.toMatch(/original was \d{4,}\d chars/);
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

    it.each(["42", '"a string"', "null", "[1,2]", "{}"])(
      "treats JSON that is not an error envelope as opaque: %s",
      (body) => {
        const out = parseErrorEnvelope(body);
        expect(out.code).toBeUndefined();
        expect(out.detail).toBeUndefined();
        expect(out.legacyDetail).toBe(false);
      },
    );

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

    it.each(["engine_error", "llm_executor_unavailable", "invalid_workflow", "context_canceled"])(
      "classifies the platform type %s as nlp_service",
      (errorType) => {
        expect(classifyEngineFailure({ errorType })).toBe("nlp_service");
      },
    );

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

    it.each([
      "bad_request",
      "invalid_dataset",
      "unsupported_node_kind",
      "code_block_timeout",
      "ssrf_blocked",
    ])("classifies the customer-fault herr code %s as user_code", (code) => {
      expect(
        classifyHttpFailure({
          status: 400,
          envelope: parseErrorEnvelope(herrBody(code, "x")),
        }),
      ).toBe("user_code");
    });

    it("classifies a legacy detail on a non-500 status as nlp_service", () => {
      expect(
        classifyHttpFailure({
          status: 503,
          envelope: parseErrorEnvelope(JSON.stringify({ detail: "down" })),
        }),
      ).toBe("nlp_service");
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

    it("agrees with the engine path on invalid_workflow, whichever transport carried it", () => {
      // The engine can report the same root cause as a 200 node failure or as
      // a non-2xx herr envelope. Same cause must not get opposite blame.
      const viaHerr = classifyHttpFailure({
        status: 400,
        envelope: parseErrorEnvelope(herrBody("invalid_workflow", "bad dsl")),
      });
      const viaEngine = classifyEngineFailure({ errorType: "invalid_workflow" });
      expect(viaHerr).toBe(viaEngine);
      expect(viaHerr).toBe("nlp_service");
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

    // These fixtures carry a REAL internal address. The previous version of
    // this test asserted absence against address-free bodies, so it passed
    // whether or not anything redacted — a vacuous absence assertion.
    it("strips the upstream address an infra error page names", () => {
      const out = formatHttpError({
        status: 502,
        rawBody:
          "<html><body><p>upstream connect error: connecting to 10.4.2.11:5561</p></body></html>",
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).not.toMatch(/10\.4\.2\.11/);
      expect(out.message).not.toMatch(/5561/);
    });

    it("strips the internal endpoint a herr infra message names", () => {
      const out = formatHttpError({
        status: 503,
        rawBody: herrBody(
          "child_unavailable",
          "dial tcp http://nlp-internal:5561/go/studio/execute_sync: connection refused",
        ),
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).not.toMatch(/nlp-internal/);
      expect(out.message).not.toMatch(/execute_sync/);
    });

    it("leaves a URL the customer wrote in their own traceback intact", () => {
      // The mirror of the two above: redacting the customer's own URL would
      // hide their bug from them, so the user-code branch is not redacted.
      const out = formatHttpError({
        status: 500,
        rawBody: JSON.stringify({
          detail:
            "httpx.ConnectError: failed to reach https://api.theirservice.com/v1/chat",
        }),
      });
      expect(out.source).toBe("user_code");
      expect(out.message).toMatch(/api\.theirservice\.com/);
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
      // NOTE: `.code` is preferred and short-circuits before redaction, so
      // this test does NOT exercise redactInternalAddresses — it pins the
      // code-preference itself. The no-code case below is what pins redaction.
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

    it("redacts the address when the cause carries no code to fall back on", () => {
      // This is the case that forces the redaction path: no `.code`, so the
      // raw message is what gets rendered. Deleting redactInternalAddresses
      // fails here and nowhere else on this branch.
      const inner = new Error("connect ECONNREFUSED 10.4.2.11:5561");
      const out = formatFetchError({
        cause: new TypeError("fetch failed", { cause: inner }),
      });
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

    it("removes a bare ipv4 address carrying no port", () => {
      // A real getaddrinfo/connect failure often names the host with no port.
      expect(redactInternalAddresses("no route to 10.4.2.11")).not.toMatch(
        /10\.4\.2\.11/,
      );
    });

    // This function now runs over infra error bodies, so over-redaction is
    // user-visible damage, not a cosmetic nit.
    it.each([
      ['File "user.py", line 42', /user\.py/],
      ["script.py:42: DeprecationWarning: old api", /script\.py:42/],
      ["retry after 12:34:56 UTC", /12:34:56/],
      ["exit code:127", /code:127/],
    ])("leaves ordinary colon-bearing text intact: %s", (input, survives) => {
      expect(redactInternalAddresses(input)).toMatch(survives);
    });

    it("leaves a source-file location intact even without trailing punctuation", () => {
      // The earlier guard only held because the fixture happened to have a
      // trailing colon; a bare `script.py:42` was still being redacted.
      expect(redactInternalAddresses('File "script.py:42"')).toMatch(
        /script\.py:42/,
      );
      expect(redactInternalAddresses("at handler.go:1204")).toMatch(
        /handler\.go:1204/,
      );
    });

    it("completes in linear time on the input that made the old pattern exponential", () => {
      // Guards the CodeQL js/redos finding (high). The previous host pattern
      // let a `-` be consumed by either of two adjacent quantifiers, so a
      // dash-separated run that ultimately FAILS to match backtracks
      // exponentially: measured on the old pattern, 20 repeats took 37ms,
      // 24 took 570ms and 26 took 2276ms — a ~60-character string. Upstream
      // error bodies are attacker-influenceable, so this was reachable.
      // 200 repeats would not terminate this decade under the old pattern.
      const evil = `a${"-a".repeat(200)}!`;
      const started = performance.now();
      redactInternalAddresses(evil);
      expect(performance.now() - started).toBeLessThan(1_000);
    });
  });
});
