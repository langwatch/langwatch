/**
 * The wire → CLI reading of the platform's errors, pinned against the THREE
 * dialects the REST surface actually speaks (see the module doc for what each
 * is and who emits it), plus the round-trip the JSON error document makes
 * through Langy's panel.
 */
import { describe, expect, it } from "vitest";
import {
  domainErrorFromThrown,
  parseDomainError,
  readCliErrorDocument,
  toCliErrorDocument,
} from "./domain-error.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("parseDomainError, given dialect 1 (the flattened Hono handler body)", () => {
  const body = {
    error: "dataset_not_found",
    message: "Dataset not found: sales-q3",
    id: "sales-q3",
    trace: {
      traceId: TRACE_ID,
      spanId: "00f067aa0ba902b7",
      traceUrl: "https://grafana.example.com/explore?traceId=4bf",
      logsUrl: "https://grafana.example.com/explore?logs=4bf",
    },
  };

  it("reads the code off `error` and the sentence off `message`", () => {
    const parsed = parseDomainError({ status: 404, body });

    expect(parsed).toMatchObject({
      code: "dataset_not_found",
      kind: "dataset_not_found",
      message: "Dataset not found: sales-q3",
      httpStatus: 404,
      isDomain: true,
    });
  });

  it("lifts the trace id out of the nested `trace` block instead of meta", () => {
    const parsed = parseDomainError({ status: 404, body });

    expect(parsed.traceId).toBe(TRACE_ID);
    expect(parsed.traceUrl).toBe(
      "https://grafana.example.com/explore?traceId=4bf",
    );
    expect(parsed.logsUrl).toBe(
      "https://grafana.example.com/explore?logs=4bf",
    );
    expect(parsed.meta).toEqual({ id: "sales-q3" });
  });

  it("does not let a meta `code` key shadow the real discriminant on `error`", () => {
    // Dialect 1 spreads meta flat, so a meta bag holding a literal `code` key
    // arrives looking like dialect 3's discriminant. With no `kind` beside it
    // (dialect 3 always emits the pair), `error` is the code.
    const parsed = parseDomainError({
      status: 422,
      body: {
        error: "validation_error",
        message: "Validation error",
        code: "schema_failure",
      },
    });

    expect(parsed.code).toBe("validation_error");
  });

  it("keeps the flat meta spread, minus the envelope's own fields", () => {
    const parsed = parseDomainError({ status: 404, body });

    expect(parsed.meta).not.toHaveProperty("trace");
    expect(parsed.meta).not.toHaveProperty("error");
    expect(parsed.meta).not.toHaveProperty("message");
  });
});

describe("parseDomainError, given dialect 2 (serialize() under `domainError`)", () => {
  it("keeps the trace, the reason chain and the advice the route forwarded", () => {
    const parsed = parseDomainError({
      status: 429,
      body: {
        error: "Rate limited: slow down",
        domainError: {
          code: "rate_limited",
          kind: "rate_limited",
          meta: { retryAfterSeconds: 30 },
          traceId: TRACE_ID,
          traceUrl: "https://grafana.example.com/explore?traceId=4bf",
          reasons: [{ code: "upstream_saturated", kind: "upstream_saturated" }],
          suggestions: ["Back off and retry"],
          docUrl: "https://langwatch.ai/docs/ai-gateway/rate-limits",
        },
      },
    });

    expect(parsed).toMatchObject({
      code: "rate_limited",
      message: "Rate limited: slow down",
      meta: { retryAfterSeconds: 30 },
      traceId: TRACE_ID,
      traceUrl: "https://grafana.example.com/explore?traceId=4bf",
      reasons: [{ kind: "upstream_saturated" }],
      suggestions: ["Back off and retry"],
      docUrl: "https://langwatch.ai/docs/ai-gateway/rate-limits",
      isDomain: true,
    });
  });

  it("still reads an older server that sends only the deprecated `kind`", () => {
    const parsed = parseDomainError({
      status: 404,
      body: {
        error: "Dataset not found: sales-q3",
        domainError: { kind: "dataset_not_found", meta: { id: "sales-q3" } },
      },
    });

    expect(parsed.code).toBe("dataset_not_found");
    expect(parsed.kind).toBe("dataset_not_found");
  });
});

describe("parseDomainError, given dialect 3 (the new framework envelope)", () => {
  const body = {
    error: "Unprocessable Entity",
    code: "validation_error",
    kind: "validation_error",
    message: "Validation error",
    meta: { fieldErrors: { name: ["Required"] } },
    reasons: [{ code: "schema_failure", meta: { field: "name" } }],
    traceId: TRACE_ID,
    spanId: "00f067aa0ba902b7",
    traceUrl: "https://grafana.example.com/explore?traceId=4bf",
    suggestions: ["Check the field errors"],
    docUrl: "https://langwatch.ai/docs/api-reference",
  };

  it("reads meta from its own key, not from a flat spread", () => {
    const parsed = parseDomainError({ status: 422, body });

    expect(parsed.meta).toEqual({ fieldErrors: { name: ["Required"] } });
  });

  it("keeps the reasons, trace, and advice — and the status text is not the message", () => {
    const parsed = parseDomainError({ status: 422, body });

    expect(parsed).toMatchObject({
      code: "validation_error",
      message: "Validation error",
      reasons: [{ kind: "schema_failure", meta: { field: "name" } }],
      traceId: TRACE_ID,
      traceUrl: "https://grafana.example.com/explore?traceId=4bf",
      suggestions: ["Check the field errors"],
      docUrl: "https://langwatch.ai/docs/api-reference",
      isDomain: true,
    });
  });
});

describe("parseDomainError, given the `code` ↔ `kind` transition", () => {
  it("resolves the discriminant from `code` alone (new server)", () => {
    const parsed = parseDomainError({
      status: 404,
      body: { code: "dataset_not_found", message: "Dataset not found" },
    });

    expect(parsed.code).toBe("dataset_not_found");
    expect(parsed.kind).toBe("dataset_not_found");
  });

  it("resolves the same error from `kind` alone (old server)", () => {
    const parsed = parseDomainError({
      status: 404,
      body: { kind: "dataset_not_found", message: "Dataset not found" },
    });

    expect(parsed.code).toBe("dataset_not_found");
    expect(parsed.kind).toBe("dataset_not_found");
  });
});

describe("parseDomainError, given a failure the platform did NOT name", () => {
  it("degrades an unrecognisable body to a status-coded infrastructure error", () => {
    const parsed = parseDomainError({ status: 502, body: "<html>Bad Gateway</html>" });

    expect(parsed).toMatchObject({
      code: "internal_error",
      isDomain: false,
      httpStatus: 502,
    });
  });

  it("calls a dead socket a network error, with status 0 semantics unchanged", () => {
    const parsed = parseDomainError({ status: 0, body: null });

    expect(parsed).toMatchObject({
      code: "network_error",
      httpStatus: 0,
      isDomain: false,
    });
  });

  it("trusts a specific code with no status, but never a generic one", () => {
    expect(
      parseDomainError({
        status: 0,
        body: { error: "dataset_not_found", message: "Dataset not found" },
      }).isDomain,
    ).toBe(true);

    expect(
      parseDomainError({
        status: 0,
        body: { error: "Internal server error", message: "An unknown error occurred" },
      }).isDomain,
    ).toBe(false);
  });

  it("never lets a 5xx present itself as the caller's fault, whatever the body says", () => {
    const parsed = parseDomainError({
      status: 500,
      body: { error: "dataset_not_found", message: "Dataset not found" },
    });

    expect(parsed.isDomain).toBe(false);
  });
});

describe("the JSON error document round-trip", () => {
  it("carries code, kind, advice and trace through to the reader intact", () => {
    const parsed = parseDomainError({
      status: 429,
      body: {
        code: "rate_limited",
        message: "Rate limited",
        meta: { retryAfterSeconds: 30 },
        traceId: TRACE_ID,
        traceUrl: "https://grafana.example.com/explore?traceId=4bf",
        logsUrl: "https://grafana.example.com/explore?logs=4bf",
        reasons: [{ code: "upstream_saturated" }],
        suggestions: ["Back off and retry"],
        docUrl: "https://langwatch.ai/docs/ai-gateway/rate-limits",
      },
    });

    const read = readCliErrorDocument(
      JSON.stringify(toCliErrorDocument(parsed)),
    );

    expect(read).toEqual(parsed);
  });

  it("still reads a document written before `code` existed (kind only)", () => {
    const read = readCliErrorDocument({
      ok: false,
      error: {
        kind: "dataset_not_found",
        message: "Dataset not found",
        httpStatus: 404,
        meta: {},
        isDomain: true,
      },
    });

    expect(read).toMatchObject({
      code: "dataset_not_found",
      kind: "dataset_not_found",
    });
  });

  it("answers null for output that is not an error document", () => {
    expect(readCliErrorDocument("not json")).toBeNull();
    expect(readCliErrorDocument({ ok: true })).toBeNull();
  });
});

describe("domainErrorFromThrown", () => {
  it("trusts the SDK's own typed error, advice and trace included", () => {
    const thrown = {
      isLangWatchDomainError: true,
      code: "budget_exceeded",
      message: "Budget exceeded",
      httpStatus: 402,
      meta: { budgetId: "budget-1" },
      traceId: TRACE_ID,
      traceUrl: "https://grafana.example.com/explore?traceId=4bf",
      reasons: [{ code: "spend_over_cap" }],
      suggestions: ["Raise the budget"],
      docUrl: "https://langwatch.ai/docs/ai-gateway/budgets",
    };

    expect(domainErrorFromThrown(thrown)).toMatchObject({
      code: "budget_exceeded",
      kind: "budget_exceeded",
      traceId: TRACE_ID,
      traceUrl: "https://grafana.example.com/explore?traceId=4bf",
      reasons: [{ kind: "spend_over_cap" }],
      suggestions: ["Raise the budget"],
      docUrl: "https://langwatch.ai/docs/ai-gateway/budgets",
      isDomain: true,
    });
  });

  it("still recognises a typed error from before the rename (kind only)", () => {
    const parsed = domainErrorFromThrown({
      isLangWatchDomainError: true,
      kind: "dataset_not_found",
      message: "Dataset not found",
      httpStatus: 404,
      meta: {},
    });

    expect(parsed.code).toBe("dataset_not_found");
  });

  it("unwraps a service wrapper to the wire body underneath", () => {
    const parsed = domainErrorFromThrown(
      Object.assign(new Error("Failed to get dataset: Dataset not found"), {
        status: 404,
        originalError: {
          error: "dataset_not_found",
          message: "Dataset not found: sales-q3",
          id: "sales-q3",
        },
      }),
    );

    expect(parsed).toMatchObject({
      code: "dataset_not_found",
      message: "Dataset not found: sales-q3",
      meta: { id: "sales-q3" },
      isDomain: true,
    });
  });

  it("reports anything unrecognisable as infrastructure, not a claimed code", () => {
    const parsed = domainErrorFromThrown(new Error("fetch failed"));

    expect(parsed).toMatchObject({ isDomain: false, message: "fetch failed" });
  });
});

/**
 * The shape `fetch` ACTUALLY throws when the transport fails: a
 * `TypeError("fetch failed")` whose `cause` is the libuv system error. Its own
 * enumerable keys are `{ errno, code, syscall, address, port }`, so it carries a
 * top-level `code` — `ECONNREFUSED`, `ENOTFOUND`, a TLS cert code — that is not
 * a discriminant the platform ever chose.
 *
 * A hand-rolled `new Error("fetch failed")` with no `cause` cannot stand in for
 * this: it is the `cause` that carries the `code`, and the `code` is the whole
 * hazard. Read as a domain error, a dead socket renders as though the USER had
 * done something wrong, and the local address and port ride along in `meta`.
 */
const systemError = ({
  message,
  code,
  errno,
  syscall,
  extra = {},
}: {
  message: string;
  code: string;
  errno: number;
  syscall: string;
  extra?: Record<string, unknown>;
}) =>
  Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(message), {
      errno,
      code,
      syscall,
      ...extra,
    }),
  });

describe("domainErrorFromThrown, given a transport failure fetch threw", () => {
  describe("when the socket was refused", () => {
    const refused = () =>
      systemError({
        message: "connect ECONNREFUSED 127.0.0.1:5560",
        code: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
        extra: { address: "127.0.0.1", port: 5560 },
      });

    it("classifies a refused connection as infrastructure", () => {
      const parsed = domainErrorFromThrown(refused());

      expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
    });

    it("never claims the libuv code as a domain discriminant", () => {
      const parsed = domainErrorFromThrown(refused());

      expect(parsed.code).not.toBe("ECONNREFUSED");
      expect(parsed.kind).not.toBe("ECONNREFUSED");
    });

    it("keeps the local address and port out of the rendered document", () => {
      const rendered = JSON.stringify(
        toCliErrorDocument(domainErrorFromThrown(refused())),
      );

      expect(rendered).not.toContain("127.0.0.1");
      expect(rendered).not.toContain("5560");
      expect(rendered).not.toContain("syscall");
      expect(rendered).not.toContain("errno");
    });

    it("reports the failure with status 0, not a fabricated one", () => {
      expect(domainErrorFromThrown(refused()).httpStatus).toBe(0);
    });
  });

  describe("when DNS could not resolve the host", () => {
    it("classifies an unresolvable host as infrastructure", () => {
      const parsed = domainErrorFromThrown(
        systemError({
          message: "getaddrinfo ENOTFOUND app.langwatch.invalid",
          code: "ENOTFOUND",
          errno: -3008,
          syscall: "getaddrinfo",
          extra: { hostname: "app.langwatch.invalid" },
        }),
      );

      expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
    });

    it("classifies a DNS timeout as infrastructure", () => {
      const parsed = domainErrorFromThrown(
        systemError({
          message: "getaddrinfo EAI_AGAIN app.langwatch.ai",
          code: "EAI_AGAIN",
          errno: -3001,
          syscall: "getaddrinfo",
        }),
      );

      expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
    });
  });

  describe("when TLS could not verify the certificate", () => {
    it("classifies a self-signed certificate as infrastructure", () => {
      const parsed = domainErrorFromThrown(
        systemError({
          message: "self signed certificate in certificate chain",
          code: "SELF_SIGNED_CERT_IN_CHAIN",
          errno: -1,
          syscall: "connect",
        }),
      );

      expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
    });

    it("classifies an unverifiable leaf certificate as infrastructure", () => {
      const parsed = domainErrorFromThrown(
        systemError({
          message: "unable to verify the first certificate",
          code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          errno: -1,
          syscall: "connect",
        }),
      );

      expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
    });
  });

  describe("when the connection died mid-flight", () => {
    it.each([
      ["ETIMEDOUT", -60, "connect ETIMEDOUT 10.0.0.1:443"],
      ["ECONNRESET", -54, "read ECONNRESET"],
      ["EPIPE", -32, "write EPIPE"],
    ])("classifies %s as infrastructure", (code, errno, message) => {
      const parsed = domainErrorFromThrown(
        systemError({ message, code, errno, syscall: "connect" }),
      );

      expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
    });
  });

  it("keeps the transport's own sentence, so the user still learns what broke", () => {
    const parsed = domainErrorFromThrown(
      systemError({
        message: "connect ECONNREFUSED 127.0.0.1:5560",
        code: "ECONNREFUSED",
        errno: -61,
        syscall: "connect",
      }),
    );

    expect(parsed.message).toBe("fetch failed");
  });
});

describe("parseDomainError, given a bare `code` with nothing else", () => {
  it("refuses to read a lone code as a domain discriminant", () => {
    const parsed = parseDomainError({ status: 0, body: { code: "ECONNREFUSED" } });

    expect(parsed).toMatchObject({ code: "network_error", isDomain: false });
  });

  it("still reads a code that arrives with the envelope's sentence", () => {
    const parsed = parseDomainError({
      status: 0,
      body: { code: "dataset_not_found", message: "Dataset not found" },
    });

    expect(parsed).toMatchObject({ code: "dataset_not_found", isDomain: true });
  });

  it("still reads a code that arrives with the envelope's meta bag", () => {
    const parsed = parseDomainError({
      status: 404,
      body: { code: "dataset_not_found", meta: { id: "sales-q3" } },
    });

    expect(parsed).toMatchObject({
      code: "dataset_not_found",
      meta: { id: "sales-q3" },
      isDomain: true,
    });
  });
});
