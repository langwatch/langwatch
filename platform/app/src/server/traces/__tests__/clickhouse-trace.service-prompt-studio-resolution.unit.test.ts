/**
 * Unit tests for the prompt-studio read's blob-resolution seam (ADR-022, #5753).
 *
 * The playground loader reads one llm span and turns its attributes straight
 * into messages and llm config, so a span whose IO was offloaded to event_log
 * used to open on the bounded preview stored in `stored_spans`. These tests
 * mock only the ClickHouse driver and wire a real BlobStore stub, so the
 * resolution fires end-to-end through the service the router actually calls.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { createLogger } from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { resolveOffloadedSpanAttributes } from "../resolve-offloaded-traces";
import {
  fullInput,
  fullUserTurn,
  LLM_SPAN_ID,
  llmRowWithEventRef,
  llmRowWithoutEventRef,
  makeBlobStore,
  PROJECT_ID,
  previewUserTurn,
  protections,
  SIBLING_SPAN_ID,
  siblingRowWithEventRef,
  TRACE_ID,
} from "./fixtures/prompt-studio-offload-fixtures";

// ---------------------------------------------------------------------------
// Hoisted mocks: mock only the CH SQL boundary
// ---------------------------------------------------------------------------

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => {
  const app = () => ({
    clickhouse: {
      enabled: true,
      resolveClient: () => Promise.resolve({ query: mockClickHouseQuery }),
      resolveOrganizationClient: async () => {
        throw new Error("no organization client in this suite");
      },
      allInstances: async () => [],
    },
  });
  return { getApp: app, tryGetApp: app };
});

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/evaluations/evaluation.service", () => ({
  EvaluationService: Object.assign(vi.fn(), { create: () => ({}) }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan = { setAttribute: () => {}, setAttributes: () => {} };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService.getSpanForPromptStudio, offloaded IO (#5753)", () => {
  let ClickHouseTraceService: typeof import("../clickhouse-trace.service").ClickHouseTraceService;

  beforeEach(async () => {
    vi.clearAllMocks();
    ClickHouseTraceService = (await import("../clickhouse-trace.service"))
      .ClickHouseTraceService;
  });

  function makeService(blobStore: BlobStore) {
    const logger = createLogger("test");
    return new ClickHouseTraceService({
      prisma: { project: { findUnique: vi.fn() } } as never,
      resolveSpanAttributes: ({ projectId, traceId, spanId, attributes }) =>
        resolveOffloadedSpanAttributes({
          projectId,
          traceId,
          spanId,
          attributes,
          blobStore,
          logger,
        }),
    });
  }

  function returnRows(rows: unknown[]) {
    mockClickHouseQuery.mockResolvedValueOnce({
      json: () => Promise.resolve(rows),
    });
  }

  describe("given the llm span's input was offloaded to event_log", () => {
    describe("when the prompt studio read fetches it", () => {
      /** @scenario "Opening the span in prompt studio resolves the full messages" */
      it("returns the full prompt, not the bounded preview", async () => {
        const { blobStore } = makeBlobStore({ "langwatch.input": fullInput });
        returnRows([llmRowWithEventRef()]);

        const result = await makeService(blobStore).getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        const userTurn = result?.messages.find((m) => m.role === "user");
        expect(userTurn?.content).toBe(fullUserTurn);
      });

      /** @scenario "Resolution is scoped to the tenant that owns the trace" */
      it("reads event_log for that trace's own project and aggregate", async () => {
        const { blobStore, reads } = makeBlobStore({
          "langwatch.input": fullInput,
        });
        returnRows([llmRowWithEventRef()]);

        await makeService(blobStore).getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        expect(reads).toEqual([
          {
            eventId: "evt-1",
            field: "langwatch.input",
            tenantId: PROJECT_ID,
            aggregateType: "trace",
            aggregateId: TRACE_ID,
          },
        ]);
      });
    });
  });

  describe("given the trace also holds a sibling span with its own eventref", () => {
    describe("when the prompt studio read fetches the llm span", () => {
      /** @scenario "Opening one prompt does not pay to restore the whole trace" */
      it("reads event_log once, for the llm span's own pointer", async () => {
        const { blobStore, reads } = makeBlobStore({
          "langwatch.input": fullInput,
          "langwatch.output": "the sibling's full output",
        });
        returnRows([llmRowWithEventRef(), siblingRowWithEventRef()]);

        await makeService(blobStore).getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        expect(reads.map((r) => r.eventId)).toEqual(["evt-1"]);
      });
    });
  });

  describe("given the user clicked through from a non-llm span", () => {
    describe("when the read resolves to the nearest llm span", () => {
      /** @scenario "Resolution follows the span the playground will actually open" */
      it("restores the llm span's IO, not the clicked span's", async () => {
        const { blobStore, reads } = makeBlobStore({
          "langwatch.input": fullInput,
          "langwatch.output": "the clicked span's full output",
        });
        // The clicked span is a Prompt.compile-shaped sibling; the llm span is
        // the one the playground opens on, and the one whose IO must be whole.
        returnRows([siblingRowWithEventRef(), llmRowWithEventRef()]);

        const result = await makeService(blobStore).getSpanForPromptStudio(
          PROJECT_ID,
          SIBLING_SPAN_ID,
          protections,
        );

        expect(result?.spanId).toBe(LLM_SPAN_ID);
        expect(reads.map((r) => r.field)).toEqual(["langwatch.input"]);
        expect(result?.messages.find((m) => m.role === "user")?.content).toBe(
          fullUserTurn,
        );
      });
    });
  });

  describe("given the llm span carries no eventref at all", () => {
    describe("when the prompt studio read fetches it", () => {
      /** @scenario "An ordinary prompt opens as fast as it always did" */
      it("returns the stored messages without touching event_log", async () => {
        const { blobStore, reads } = makeBlobStore({
          "langwatch.input": fullInput,
        });
        returnRows([llmRowWithoutEventRef()]);

        const result = await makeService(blobStore).getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        expect(result?.messages.find((m) => m.role === "user")?.content).toBe(
          previewUserTurn,
        );
        expect(reads).toEqual([]);
      });
    });
  });

  describe("given the injected resolver rejects instead of degrading", () => {
    describe("when the prompt studio read fetches the span", () => {
      /** @scenario "A resolver that fails outright still opens the playground" */
      it("still returns the span, on its stored preview", async () => {
        const { blobStore } = makeBlobStore({ "langwatch.input": fullInput });
        returnRows([llmRowWithEventRef()]);

        const service = new ClickHouseTraceService({
          prisma: { project: { findUnique: vi.fn() } } as never,
          resolveSpanAttributes: () => {
            throw new Error("resolver blew up");
          },
        });
        // The production resolver swallows per field, so only an injected one
        // can reject, and this call sits inside the read's try, where an
        // escaping error turns "shows the preview" into "shows nothing".
        void blobStore;

        const result = await service.getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result?.messages.find((m) => m.role === "user")?.content).toBe(
          previewUserTurn,
        );
      });
    });
  });

  describe("given the eventref points at an event_log row that is gone", () => {
    describe("when the prompt studio read fetches it", () => {
      /** @scenario "A missing event_log row does not break the read" */
      it("still returns the span, on the stored preview", async () => {
        const { blobStore } = makeBlobStore({});
        returnRows([llmRowWithEventRef()]);

        const result = await makeService(blobStore).getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result?.messages.find((m) => m.role === "user")?.content).toBe(
          previewUserTurn,
        );
      });
    });
  });
});

/**
 * The suite above builds the ClickHouse service by hand, so it proves the read
 * path and nothing about how production reaches it. This one goes in through
 * TraceService.create, the constructor the router calls, so a resolver that is
 * accepted but never forwarded is a failure rather than an invisible no-op.
 *
 * Deliberately not bound to a scenario: it asserts dependency wiring, which the
 * feature files are not the place for. Same class as
 * `api/routers/__tests__/traces.4991-full-resolution.unit.test.ts`.
 */
describe("TraceService.getSpanForPromptStudio, wired from blob deps (#5753)", () => {
  let TraceService: typeof import("../trace.service").TraceService;

  beforeEach(async () => {
    vi.clearAllMocks();
    TraceService = (await import("../trace.service")).TraceService;
  });

  describe("given a TraceService built with blob-resolution deps", () => {
    describe("when the prompt studio read runs through it", () => {
      it("returns the full prompt", async () => {
        const { blobStore } = makeBlobStore({ "langwatch.input": fullInput });
        mockClickHouseQuery.mockResolvedValueOnce({
          json: () => Promise.resolve([llmRowWithEventRef()]),
        });

        const service = TraceService.create(
          { project: { findUnique: vi.fn() } } as never,
          {
            blobStore,
            ioExtractionService: new TraceIOExtractionService(),
          },
        );

        const result = await service.getSpanForPromptStudio(
          PROJECT_ID,
          LLM_SPAN_ID,
          protections,
        );

        expect(result?.messages.find((m) => m.role === "user")?.content).toBe(
          fullUserTurn,
        );
      });
    });
  });
});
