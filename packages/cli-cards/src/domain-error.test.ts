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
