/**
 * SpanStorageService.restoreStoredSpanAttributes, the guards around the read
 * (#5753): a proof that is not granted is refused, the visibility window is
 * cut exactly at the span start, and a span with several offloaded fields
 * restores each one under the same project.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { AccessNotGrantedError } from "@langwatch/actor";
import { describe, expect, it, vi } from "vitest";
import { ownProof } from "~/test-utils/authorizationProofs";

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

import { makeBlobStore } from "~/server/traces/__tests__/fixtures/prompt-studio-offload-fixtures";
import {
  eventRefKeys,
  FULL_INPUT,
  FULL_OUTPUT,
  holdsFullInput,
  offloadedSpan,
  offloadedSpanWithOutput,
  PREVIEW_OUTPUT,
  PROJECT,
  STARTED_AT,
  serviceWith,
  ungrantedProof,
} from "./fixtures/stored-span-restore-fixtures";

describe("SpanStorageService.restoreStoredSpanAttributes guards", () => {
  describe("given an offloaded span and a proof with no traces read grant", () => {
    describe("when its attributes are restored", () => {
      /** @scenario "A proof that is not granted is refused, not answered with a preview" */
      it("rejects with AccessNotGrantedError", async () => {
        await expect(
          serviceWith(holdsFullInput()).restoreStoredSpanAttributes({
            authorization: ungrantedProof(),
            span: offloadedSpan(),
            visibilityCutoffMs: null,
          }),
        ).rejects.toBeInstanceOf(AccessNotGrantedError);
      });

      /** @scenario "A proof that is not granted is refused, not answered with a preview" */
      it("reads no event_log", async () => {
        const blobStore = holdsFullInput();

        await serviceWith(blobStore)
          .restoreStoredSpanAttributes({
            authorization: ungrantedProof(),
            span: offloadedSpan(),
            visibilityCutoffMs: null,
          })
          .catch(() => undefined);

        expect(blobStore.getFromEventLog).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a visibility cutoff before the span started", () => {
    describe("when its attributes are restored", () => {
      /** @scenario "A span outside the plan's visibility window keeps the preview" */
      it("restores the full value", async () => {
        const restored = await serviceWith(
          holdsFullInput(),
        ).restoreStoredSpanAttributes({
          authorization: ownProof({ projectId: PROJECT }),
          span: offloadedSpan(),
          visibilityCutoffMs: STARTED_AT - 1,
        });

        expect(restored["langwatch.input"]).toBe(FULL_INPUT);
      });
    });
  });

  describe("given a visibility cutoff equal to the span start", () => {
    describe("when its attributes are restored", () => {
      /** @scenario "A span outside the plan's visibility window keeps the preview" */
      it("restores the full value, since a span at the cutoff is inside the window", async () => {
        const restored = await serviceWith(
          holdsFullInput(),
        ).restoreStoredSpanAttributes({
          authorization: ownProof({ projectId: PROJECT }),
          span: offloadedSpan(),
          visibilityCutoffMs: STARTED_AT,
        });

        expect(restored["langwatch.input"]).toBe(FULL_INPUT);
      });
    });
  });

  describe("given a span with both its input and output offloaded", () => {
    const bothBlobs = () =>
      makeBlobStore({
        "langwatch.input": FULL_INPUT,
        "langwatch.output": FULL_OUTPUT,
      });
    const restore = (blobStore: ReturnType<typeof bothBlobs>["blobStore"]) =>
      serviceWith(blobStore).restoreStoredSpanAttributes({
        authorization: ownProof({ projectId: PROJECT }),
        span: offloadedSpanWithOutput(),
        visibilityCutoffMs: null,
      });

    describe("when both blobs are available", () => {
      it("restores the input and the output", async () => {
        const restored = await restore(bothBlobs().blobStore);

        expect({
          input: restored["langwatch.input"],
          output: restored["langwatch.output"],
        }).toEqual({ input: FULL_INPUT, output: FULL_OUTPUT });
      });

      it("reads both fields under the same project", async () => {
        const { blobStore, reads } = bothBlobs();

        await restore(blobStore);

        expect(reads.map((read) => read.tenantId)).toEqual([PROJECT, PROJECT]);
      });

      it("leaves no eventref pointer key on the result", async () => {
        const restored = await restore(bothBlobs().blobStore);

        expect(eventRefKeys(restored)).toEqual([]);
      });
    });

    describe("when the output blob is missing", () => {
      const inputOnly = () =>
        makeBlobStore({ "langwatch.input": FULL_INPUT }).blobStore;

      /** @scenario "Unavailable content keeps the preview" */
      it("keeps the output preview and restores the input", async () => {
        const restored = await restore(inputOnly());

        expect({
          input: restored["langwatch.input"],
          output: restored["langwatch.output"],
        }).toEqual({ input: FULL_INPUT, output: PREVIEW_OUTPUT });
      });

      /** @scenario "Unavailable content keeps the preview" */
      it("leaves no eventref pointer key on the result", async () => {
        const restored = await restore(inputOnly());

        expect(eventRefKeys(restored)).toEqual([]);
      });
    });
  });
});
