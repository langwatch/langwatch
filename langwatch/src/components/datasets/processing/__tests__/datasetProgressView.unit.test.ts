import { describe, expect, it } from "vitest";
import {
  deriveDatasetProgressView,
  estimateEtaSeconds,
} from "../datasetProgressView";

describe("deriveDatasetProgressView", () => {
  describe("when getById is terminal (the durable authority)", () => {
    // I-TERMINAL-REACHED: the durable status overrides any stale ephemeral tick —
    // this is what makes the bar un-hangable. A 45% 'processing' tick that was
    // the last thing the SSE stream delivered must NOT survive a getById=ready.
    it("hides the bar on ready even with a stale processing tick still in hand", () => {
      const view = deriveDatasetProgressView({
        status: "ready",
        live: {
          bytesRead: 450,
          totalBytes: 1000,
          rows: 12,
          phase: "processing",
        },
      });
      expect(view).toEqual({ kind: "hidden" });
    });

    it("shows failed with the durable statusError regardless of the live tick", () => {
      const view = deriveDatasetProgressView({
        status: "failed",
        statusError: "Uploaded file is empty",
        live: { bytesRead: 999, totalBytes: 1000, phase: "processing" },
      });
      expect(view).toEqual({
        kind: "failed",
        message: "Uploaded file is empty",
      });
    });
  });

  describe("when still processing", () => {
    it("is determinate from input bytes once a live tick with a total arrives", () => {
      const view = deriveDatasetProgressView({
        status: "processing",
        live: {
          bytesRead: 250,
          totalBytes: 1000,
          rows: 30,
          phase: "processing",
        },
        etaSeconds: 12,
      });
      expect(view).toEqual({
        kind: "determinate",
        percent: 25,
        rows: 30,
        etaSeconds: 12,
        phase: "processing",
      });
    });

    it("falls back to the uploading status, not processing, when a tick has no phase", () => {
      const view = deriveDatasetProgressView({
        status: "uploading",
        live: { bytesRead: 100, totalBytes: 1000 },
      });
      expect(view).toMatchObject({ kind: "determinate", phase: "uploading" });
    });

    it("is honestly indeterminate with no live tick yet (refresh / dead worker)", () => {
      const view = deriveDatasetProgressView({
        status: "processing",
        live: null,
      });
      expect(view).toEqual({ kind: "indeterminate", phase: "processing" });
    });

    it("never exceeds 100% even if input bytes overshoot the total", () => {
      const view = deriveDatasetProgressView({
        status: "processing",
        live: { bytesRead: 1200, totalBytes: 1000, phase: "finalizing" },
      });
      expect(view).toMatchObject({ kind: "determinate", percent: 100 });
    });
  });

  describe("when not yet resolved", () => {
    it("hides while status is undefined (query loading)", () => {
      expect(
        deriveDatasetProgressView({ status: undefined, live: null }),
      ).toEqual({ kind: "hidden" });
    });
  });
});

describe("estimateEtaSeconds", () => {
  it("returns undefined before two samples", () => {
    expect(estimateEtaSeconds([{ t: 0, bytes: 0 }], 1000, 0)).toBeUndefined();
  });

  it("derives remaining seconds from the byte-rate over the window", () => {
    // 500 bytes over 5s = 100 B/s; 500 remaining → 5s.
    const eta = estimateEtaSeconds(
      [
        { t: 0, bytes: 0 },
        { t: 5000, bytes: 500 },
      ],
      1000,
      500,
    );
    expect(eta).toBe(5);
  });

  it("returns undefined on a non-positive rate", () => {
    expect(
      estimateEtaSeconds(
        [
          { t: 0, bytes: 500 },
          { t: 5000, bytes: 500 },
        ],
        1000,
        500,
      ),
    ).toBeUndefined();
  });
});
