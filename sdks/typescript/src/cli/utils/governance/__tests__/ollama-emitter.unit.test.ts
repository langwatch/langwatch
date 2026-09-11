/**
 * Shipping captured Ollama calls: one upload per batch, a failed upload kept
 * for the next one, and nothing that can end the session it belongs to.
 */
import { describe, expect, it, vi } from "vitest";

import { createDiscardingSpanEmitter, createOllamaSpanEmitter } from "../ollama-emitter";
import type { OtlpSpan } from "../ollama-trace";

function span(name: string): OtlpSpan {
  return {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    name,
    kind: 1,
    startTimeUnixNano: "1000000",
    endTimeUnixNano: "2000000",
    attributes: [],
    status: {},
  };
}

function spanNamesOf(call: [string, RequestInit] | undefined): string[] {
  const body = JSON.parse(String(call?.[1]?.body)) as {
    resourceSpans: { scopeSpans: { spans: { name: string }[] }[] }[];
  };
  return body.resourceSpans[0]!.scopeSpans[0]!.spans.map((s) => s.name);
}

describe("given an emitter pointed at a reachable control plane", () => {
  it("sends everything buffered in one upload, authenticated with the ingest key", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const emitter = createOllamaSpanEmitter({
      tracesEndpoint: "https://app.langwatch.ai/api/otel/v1/traces",
      token: "ik-lw-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    emitter.add(span("ollama.chat"));
    emitter.add(span("ollama.generate"));
    await emitter.close();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    expect((call[1].headers as Record<string, string>).authorization).toBe("Bearer ik-lw-test");
    expect(spanNamesOf(call)).toEqual(["ollama.chat", "ollama.generate"]);
    expect(emitter.sent()).toBe(2);
  });

  it("sends nothing when nothing was captured", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const emitter = createOllamaSpanEmitter({
      tracesEndpoint: "https://app.langwatch.ai/api/otel/v1/traces",
      token: "ik-lw-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await emitter.close();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("given a control plane that is not answering", () => {
  it("keeps the calls for the next attempt and warns once", async () => {
    let answering = false;
    const fetchImpl = vi.fn(async () => {
      if (!answering) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    });
    const warn = vi.fn();
    const emitter = createOllamaSpanEmitter({
      tracesEndpoint: "https://app.langwatch.ai/api/otel/v1/traces",
      token: "ik-lw-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn,
    });

    emitter.add(span("ollama.chat"));
    await emitter.flush();
    expect(emitter.sent()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);

    answering = true;
    emitter.add(span("ollama.generate"));
    await emitter.flush();

    // The retried call leads: the order it happened in is the order it lands.
    expect(spanNamesOf(fetchImpl.mock.calls[1] as unknown as [string, RequestInit])).toEqual([
      "ollama.chat",
      "ollama.generate",
    ]);
    expect(emitter.sent()).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("treats a rejection from the platform as a failure to retry, not a success", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const emitter = createOllamaSpanEmitter({
      tracesEndpoint: "https://app.langwatch.ai/api/otel/v1/traces",
      token: "ik-lw-wrong",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      warn: vi.fn(),
    });

    emitter.add(span("ollama.chat"));
    await emitter.close();

    expect(emitter.sent()).toBe(0);
  });
});

describe("given no LangWatch scope", () => {
  it("accepts calls and does nothing with them", async () => {
    const emitter = createDiscardingSpanEmitter();

    emitter.add(span("ollama.chat"));
    await emitter.flush();
    await emitter.close();

    expect(emitter.sent()).toBe(0);
  });
});
