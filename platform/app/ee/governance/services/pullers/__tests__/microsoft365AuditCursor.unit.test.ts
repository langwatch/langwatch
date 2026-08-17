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

  /** @scenario Blob queue carried in the cursor is bounded */
  it("caps the queue it writes so the cursor cannot grow with tenant volume", () => {
    const oversized = cursor({
      blobQueue: Array.from(
        { length: MAX_QUEUED_BLOBS + 500 },
        (_, i) => `https://blob.test/${i}`,
      ),
    });

    const encoded = encodeCursor(oversized);
    const decoded = decodeCursor(encoded);

    expect(decoded.cursor?.blobQueue).toHaveLength(MAX_QUEUED_BLOBS);
    // The kept entries are the head of the listing, so what was dropped is
    // recoverable by listing again — deferred, not lost.
    expect(decoded.cursor?.blobQueue[0]).toBe("https://blob.test/0");
  });
});
