/**
 * A braided span is read alone and its offloaded body restored from where its owner stored it
 * (ADR-022, ADR-185 §5). Spec: modules/trace/specs/braided-spans.feature
 */
import { EVENTREF_ATTR_PREFIX } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import {
  braidedProof,
  ownProof,
} from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { NullSpanStorageRepository } from "../../../../repositories/span-storage.repository.ts";
import { blobStoreReading } from "../../../../services/__tests__/support/trace-blob-store.support.ts";
import { TraceIOExtractionService } from "../../../derivation/services/trace-io-extraction.service.ts";
import { SpanStorageService } from "../trace-span-storage-read.service.ts";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: () => void; setAttributes: () => void }) => unknown,
    ) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
  }),
}));

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const FULL_INPUT = "the whole input the owner stored apart";

function ownerSpanStoredApart() {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: OWNER,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1_000,
    endTimeUnixMs: 2_000,
    durationMs: 1_000,
    name: "specialist",
    kind: 1,
    resourceAttributes: {},
    spanAttributes: {
      "langwatch.input": "the whole input…",
      [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
        field: "langwatch.input",
        eventId: "evt-1",
      }),
    },
    events: [],
    links: [],
    statusMessage: null,
    statusCode: 1,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  } as const;
}

function spanStorage() {
  const blobTenants: string[] = [];
  const repository = Object.assign(new NullSpanStorageRepository(), {
    findNormalizedSpanByIds: vi.fn(async () => ({ ...ownerSpanStoredApart() })),
    findNormalizedSpansByTraceId: vi.fn(async () => []),
  });
  const service = SpanStorageService.create({
    repository,
    blobResolutionDeps: {
      blobStore: blobStoreReading(async ({ tenantId }) => {
        blobTenants.push(tenantId);
        return FULL_INPUT;
      }),
      ioExtractionService: TraceIOExtractionService.create(TraceCanonicalisationService.create()),
    },
  });
  return { service, repository, blobTenants };
}

describe("SpanStorageService.findSpanById for a braided span", () => {
  describe("when the reader selects an owner's span whose input was stored apart", () => {
    /** @scenario "A braided span's large body is read from its owning project" */
    it("restores the input from the owning project", async () => {
      const { service, repository, blobTenants } = spanStorage();

      const span = await service.findSpanById({
        authorization: braidedProof({ projectId: READER, braids: [{ owner: OWNER }] }),
        traceId: "trace-1",
        spanId: "span-1",
        ownerProjectId: OWNER,
      });

      expect(JSON.stringify(span?.input)).toContain(FULL_INPUT);
      expect(blobTenants).toEqual([OWNER]);
      expect(repository.findNormalizedSpansByTraceId).not.toHaveBeenCalled();
    });
  });

  describe("when a proof without braids names another project's span", () => {
    it("reads nothing and finds no span", async () => {
      const { service, repository } = spanStorage();

      const span = await service.findSpanById({
        authorization: ownProof({ projectId: READER }),
        traceId: "trace-1",
        spanId: "span-1",
        ownerProjectId: OWNER,
      });

      expect(span).toBeNull();
      expect(repository.findNormalizedSpanByIds).not.toHaveBeenCalled();
      expect(repository.findNormalizedSpansByTraceId).not.toHaveBeenCalled();
    });
  });
});
