/**
 * SpanStorageService.restoreStoredSpanAttributes: restores one stored span's
 * ADR-022 offloaded content, under the one project the proof reads (#5753).
 *
 * The playground read fenced by a proof loads stored rows; this restores the
 * llm row's full content from event_log. It is a tenant-isolation seam: a
 * proof that reads several projects restores nothing, and a narrowed proof
 * restores under its member, never under the aggregate.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { narrowAuthorization } from "@langwatch/actor";
import { describe, expect, it, vi } from "vitest";
import { aggregateProof, ownProof } from "~/test-utils/authorizationProofs";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
      }) => unknown,
    ) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import {
  AGGREGATE,
  blobStoreReturning,
  eventRefKeys,
  FULL_INPUT,
  holdsFullInput,
  MEMBER,
  offloadedSpan,
  PREVIEW_INPUT,
  PROJECT,
  plainSpan,
  serviceWith,
  STARTED_AT,
  TRACE_ID,
} from "./fixtures/stored-span-restore-fixtures";

describe("SpanStorageService.restoreStoredSpanAttributes", () => {
  describe("given a span with no eventref pointer", () => {
    describe("when its attributes are restored", () => {
      /** @scenario "An ordinary prompt opens as fast as it always did" */
      it("returns the attributes unchanged and reads no event_log", async () => {
        const blobStore = holdsFullInput();
        const span = plainSpan();

        const restored = await serviceWith(blobStore).restoreStoredSpanAttributes(
          { authorization: ownProof({ projectId: PROJECT }), span },
        );

        expect(restored).toEqual(span.spanAttributes);
        expect(blobStore.getFromEventLog).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an offloaded span and a proof that reads one project", () => {
    describe("when its attributes are restored", () => {
      /** @scenario "A trace-named link opens the full prompt" */
      it("returns the full value under the proof's project and trace", async () => {
        const blobStore = holdsFullInput();

        const restored = await serviceWith(blobStore).restoreStoredSpanAttributes(
          {
            authorization: ownProof({ projectId: PROJECT }),
            span: offloadedSpan(),
          },
        );

        expect(restored["langwatch.input"]).toBe(FULL_INPUT);
        expect(blobStore.getFromEventLog).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: PROJECT,
            aggregateId: TRACE_ID,
            eventId: "evt-1",
            field: "langwatch.input",
          }),
        );
      });

      /** @scenario "A trace-named link opens the full prompt" */
      it("leaves no eventref pointer key on the result", async () => {
        const restored = await serviceWith(
          holdsFullInput(),
        ).restoreStoredSpanAttributes({
          authorization: ownProof({ projectId: PROJECT }),
          span: offloadedSpan(),
        });

        expect(eventRefKeys(restored)).toEqual([]);
      });
    });
  });

  describe("given a proof that still reads several projects", () => {
    const aggregateReadsMember = () =>
      aggregateProof({
        projectId: AGGREGATE,
        members: [{ projectId: MEMBER, from: 0 }],
      });

    describe("when its attributes are restored", () => {
      /** @scenario "A proof that reads several projects keeps the preview" */
      it("reads no event_log at all", async () => {
        const blobStore = holdsFullInput();

        await serviceWith(blobStore).restoreStoredSpanAttributes({
          authorization: aggregateReadsMember(),
          span: offloadedSpan(),
        });

        expect(blobStore.getFromEventLog).not.toHaveBeenCalled();
      });

      /** @scenario "A proof that reads several projects keeps the preview" */
      it("keeps the preview and strips the eventref keys", async () => {
        const restored = await serviceWith(
          holdsFullInput(),
        ).restoreStoredSpanAttributes({
          authorization: aggregateReadsMember(),
          span: offloadedSpan(),
        });

        expect({
          input: restored["langwatch.input"],
          refs: eventRefKeys(restored),
        }).toEqual({ input: PREVIEW_INPUT, refs: [] });
      });
    });

    describe("when the proof is narrowed to the member", () => {
      /** @scenario "An aggregate narrowed to a member reads the member's content" */
      it("reads event_log under the member, never the aggregate", async () => {
        const blobStore = holdsFullInput();
        const narrowed = narrowAuthorization({
          authorization: aggregateReadsMember(),
          projectId: MEMBER,
        })!;

        const restored = await serviceWith(blobStore).restoreStoredSpanAttributes(
          { authorization: narrowed, span: offloadedSpan() },
        );

        expect(blobStore.getFromEventLog).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: MEMBER }),
        );
        expect(restored["langwatch.input"]).toBe(FULL_INPUT);
      });

      /** @scenario "An aggregate narrowed to a member reads the member's content" */
      it("never reads event_log under the aggregate's id", async () => {
        const blobStore = holdsFullInput();
        const narrowed = narrowAuthorization({
          authorization: aggregateReadsMember(),
          projectId: MEMBER,
        })!;

        await serviceWith(blobStore).restoreStoredSpanAttributes({
          authorization: narrowed,
          span: offloadedSpan(),
        });

        expect(blobStore.getFromEventLog).not.toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: AGGREGATE }),
        );
      });
    });
  });

  describe("given a visibility cutoff", () => {
    describe("when the span started before the cutoff", () => {
      /** @scenario "A span outside the plan's visibility window keeps the preview" */
      it("reads no event_log and keeps the preview without pointers", async () => {
        const blobStore = holdsFullInput();

        const restored = await serviceWith(blobStore).restoreStoredSpanAttributes(
          {
            authorization: ownProof({ projectId: PROJECT }),
            span: offloadedSpan(),
            visibilityCutoffMs: STARTED_AT + 1,
          },
        );

        expect(blobStore.getFromEventLog).not.toHaveBeenCalled();
        expect({
          input: restored["langwatch.input"],
          refs: eventRefKeys(restored),
        }).toEqual({ input: PREVIEW_INPUT, refs: [] });
      });
    });

    describe("when the cutoff is null", () => {
      it("restores the full value, ungated", async () => {
        const restored = await serviceWith(
          holdsFullInput(),
        ).restoreStoredSpanAttributes({
          authorization: ownProof({ projectId: PROJECT }),
          span: offloadedSpan(),
          visibilityCutoffMs: null,
        });

        expect(restored["langwatch.input"]).toBe(FULL_INPUT);
      });
    });
  });

  describe("given the offloaded content cannot be read", () => {
    describe("when the event_log read rejects", () => {
      /** @scenario "Unavailable content keeps the preview" */
      it("does not throw and keeps the preview without pointers", async () => {
        const blobStore = blobStoreReturning(async () => {
          throw new BlobNotFoundError("evt-1", "langwatch.input", PROJECT);
        });

        const restored = await serviceWith(blobStore).restoreStoredSpanAttributes(
          {
            authorization: ownProof({ projectId: PROJECT }),
            span: offloadedSpan(),
          },
        );

        expect({
          input: restored["langwatch.input"],
          refs: eventRefKeys(restored),
        }).toEqual({ input: PREVIEW_INPUT, refs: [] });
      });
    });
  });

  describe("given a service built without blob deps", () => {
    describe("when its attributes are restored", () => {
      /** @scenario "Unavailable content keeps the preview" */
      it("keeps the preview and strips the eventref keys", async () => {
        const restored = await serviceWith().restoreStoredSpanAttributes({
          authorization: ownProof({ projectId: PROJECT }),
          span: offloadedSpan(),
        });

        expect({
          input: restored["langwatch.input"],
          refs: eventRefKeys(restored),
        }).toEqual({ input: PREVIEW_INPUT, refs: [] });
      });
    });
  });
});
