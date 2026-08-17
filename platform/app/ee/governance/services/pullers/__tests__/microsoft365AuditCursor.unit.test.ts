/**
 * Unit coverage for the Management Activity API cursor codec.
 *
 * Decoding is total by construction, and that is the property worth pinning:
 * throwing would wedge a source permanently on one bad write, and restarting
 * the window from zero would re-pull history every run forever while looking
 * healthy.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { describe, expect, it } from "vitest";

import {
  CURSOR_VERSION,
  decodeCursor,
  encodeCursor,
  MAX_CURSOR_BLOBS,
  MAX_QUEUED_BLOBS,
  type Microsoft365AuditCursor,
} from "../shared/microsoft365AuditCursor";

const WATERMARK = "2026-05-03T00:00:00.000Z";

const cursor = (
  overrides: Partial<Microsoft365AuditCursor> = {},
): Microsoft365AuditCursor => ({
  version: CURSOR_VERSION,
  phase: "draining",
  windowStart: "2026-05-03T00:00:00.000Z",
  windowEnd: "2026-05-03T01:00:00.000Z",
  blobQueue: [
    "https://blob.test/1",
    "https://blob.test/2",
    "https://blob.test/3",
  ],
  watermark: WATERMARK,
  ...overrides,
});

describe("microsoft365AuditCursor", () => {
  /** @scenario Cursor round-trips through encode and decode */
  it("round-trips a draining cursor with its queue and watermark intact", () => {
    const original = cursor();
    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded.recoveredFrom).toBeUndefined();
    expect(decoded.cursor).toEqual(original);
  });

  it("round-trips the listing page position when the listing paged", () => {
    const original = cursor({
      phase: "listing",
      nextPageUri: "https://manage.office.test/next-page",
    });
    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded.cursor?.nextPageUri).toBe(
      "https://manage.office.test/next-page",
    );
  });

  /** @scenario Undecodable cursor resumes from the watermark instead of throwing */
  it("resumes from the watermark for every unusable shape, never throwing", () => {
    const cases: Array<{ raw: string; reason: string }> = [
      { raw: "not-json", reason: "corrupt" },
      {
        raw: JSON.stringify({ version: 0, watermark: WATERMARK }),
        reason: "unknown version",
      },
      {
        raw: JSON.stringify({
          version: CURSOR_VERSION,
          phase: "nonsense",
          watermark: WATERMARK,
        }),
        reason: "unknown phase",
      },
      {
        raw: JSON.stringify("a legacy bare string cursor"),
        reason: "pre-existing shape",
      },
      {
        raw: JSON.stringify({
          version: CURSOR_VERSION,
          phase: "draining",
          windowStart: "not-a-date",
          windowEnd: "also-not",
          blobQueue: [],
          watermark: WATERMARK,
        }),
        reason: "window not a pair of timestamps",
      },
      {
        raw: JSON.stringify({
          version: CURSOR_VERSION,
          phase: "draining",
          windowStart: WATERMARK,
          windowEnd: WATERMARK,
          blobQueue: [1, 2, 3],
          watermark: WATERMARK,
        }),
        reason: "queue not strings",
      },
    ];

    for (const { raw, reason } of cases) {
      let decoded: ReturnType<typeof decodeCursor> | undefined;
      expect(() => {
        decoded = decodeCursor(raw);
      }, reason).not.toThrow();

      expect(decoded?.recoveredFrom, reason).toBeDefined();

      // Where a watermark survived, it is what we resume from — NOT zero.
      if (raw.includes(WATERMARK)) {
        expect(decoded?.cursor?.watermark, reason).toBe(WATERMARK);
        expect(decoded?.cursor?.windowStart, reason).toBe(WATERMARK);
      }
    }
  });

  it("treats a null or blank cursor as a first run rather than a recovery", () => {
    expect(decodeCursor(null)).toEqual({ cursor: null });
    expect(decodeCursor("")).toEqual({ cursor: null });
    expect(decodeCursor("   ")).toEqual({ cursor: null });
  });

  /** @scenario A queue above the listing cap survives the round trip intact */
  it("carries every queued blob through the round trip rather than dropping the tail", () => {
    // One listing page can push the queue past MAX_QUEUED_BLOBS, because the
    // cap is checked after the page is appended. This used to be sliced back
    // down on the way out, which is not deferral: nothing re-lists a dropped
    // URI, and the window then advances past the records it pointed at.
    const overCap = cursor({
      blobQueue: Array.from(
        { length: MAX_QUEUED_BLOBS + 500 },
        (_, i) => `https://blob.test/${i}`,
      ),
    });

    const decoded = decodeCursor(encodeCursor(overCap));

    expect(decoded.cursor?.blobQueue).toHaveLength(MAX_QUEUED_BLOBS + 500);
    expect(decoded.cursor?.blobQueue.at(0)).toBe("https://blob.test/0");
    expect(decoded.cursor?.blobQueue.at(-1)).toBe(
      `https://blob.test/${MAX_QUEUED_BLOBS + 499}`,
    );
  });

  /** @scenario A queue above the corruption ceiling is rejected, not truncated */
  it("resumes from the watermark when the queue is implausibly large", () => {
    const corrupt = cursor({
      blobQueue: Array.from(
        { length: MAX_CURSOR_BLOBS + 1 },
        (_, i) => `https://blob.test/${i}`,
      ),
    });

    const decoded = decodeCursor(JSON.stringify(corrupt));

    // Salvaged, not silently trimmed — the watermark is the honest resume
    // point when the queue cannot be trusted.
    expect(decoded.cursor?.blobQueue).toEqual([]);
    expect(decoded.cursor?.watermark).toBe(WATERMARK);
    expect(decoded.recoveredFrom).toContain("ceiling");
  });
});
