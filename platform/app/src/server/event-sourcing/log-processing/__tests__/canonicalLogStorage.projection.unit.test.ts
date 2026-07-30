import { describe, expect, it } from "vitest";
import { canonicalizeLogRequest } from "../canonicalize";
import { stampLogRecords } from "../canonicalLogStorage.projection";
import type { CanonicalLogRecord } from "../schema";

async function fixtureRecord(acceptedAt: number): Promise<CanonicalLogRecord> {
  const result = await canonicalizeLogRequest({
    tenantId: "tenant-a",
    organizationId: "org-a",
    piiRedactionLevel: "DISABLED",
    redactionService: { redactLog: async () => undefined },
    acceptedAt,
    request: {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { name: "test.scope" },
              logRecords: [{ body: { stringValue: "one" } }],
            },
          ],
        },
      ],
    } as any,
  });
  return result.accepted[0]!.record;
}

describe("stamping a canonical log batch for its two tables", () => {
  describe("given one record is accepted, then accepted again by a replay", () => {
    it("gives the earlier acceptance the higher merge version, so the replay loses", async () => {
      const [first] = stampLogRecords(
        [await fixtureRecord(1_700_000_000_000)],
        30,
      );
      const [replay] = stampLogRecords(
        [await fixtureRecord(1_800_000_000_000)],
        30,
      );

      expect(first!.dedupVersion).toBeGreaterThan(replay!.dedupVersion);
    });

    it("does not derive the version from the write instant, which moves per delivery", async () => {
      const [stamped] = stampLogRecords(
        [await fixtureRecord(1_700_000_000_000)],
        30,
      );

      expect(stamped!.dedupVersion).not.toBe(
        BigInt(stamped!.writtenAt.getTime()),
      );
    });
  });

  it("stamps every row of one batch with the same write instant", async () => {
    const stamped = stampLogRecords(
      [
        await fixtureRecord(1_700_000_000_000),
        await fixtureRecord(1_700_000_000_001),
      ],
      30,
    );
    expect(stamped[0]!.writtenAt).toBe(stamped[1]!.writtenAt);
  });
});
