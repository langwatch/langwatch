import { describe, expect, it } from "vitest";
import { foldCodec, type VersionedRow } from "../foldCodec";

/**
 * The generation ladder is the whole read-back gate: one comparison against one
 * floor, replacing the four hand-rolled shapes the five read-back stores grew
 * (bare equality, a set of two decodable stamps, version-or-checkpoint, and no
 * gate at all).
 */

interface Row extends VersionedRow {
  checkpoint: number;
  value: number;
}

function ladderCodec(
  over: Partial<Parameters<typeof foldCodec<{ value: number }, Row>>[0]> = {},
) {
  return foldCodec<{ value: number }, Row>({
    generations: [{ stamp: "g1" }, { stamp: "g2" }, { stamp: "g3" }],
    readBackSince: 2,
    reads: ["Value"],
    project: (state, { version }) => ({
      version,
      checkpoint: 1,
      value: state.value,
    }),
    decode: (row) => ({ value: row.value }),
    ...over,
  });
}

const row = (over: Partial<Row> = {}): Row => ({
  version: "g3",
  checkpoint: 1,
  value: 7,
  ...over,
});

describe("foldCodec generation ladder", () => {
  describe("given a ladder with a floor above its oldest shape", () => {
    const codec = ladderCodec();

    /** @scenario a record written under the current shape is recovered as written */
    it("reads a row at or above the floor", () => {
      expect(codec.readable(row({ version: "g2" }))).toBe(true);
      expect(codec.readable(row({ version: "g3" }))).toBe(true);
    });

    /** @scenario a record written under a shape this build cannot read is rebuilt */
    it("refuses a row below the floor", () => {
      expect(codec.readable(row({ version: "g1" }))).toBe(false);
    });

    /** @scenario a record in a shape the fold has never known is rebuilt */
    it("refuses a stamp it has never declared", () => {
      expect(codec.readable(row({ version: "g0" }))).toBe(false);
      expect(codec.generationOf(row({ version: "g0" }))).toBe(0);
    });

    it("writes the newest declared shape", () => {
      expect(codec.writes).toBe("g3");
      expect(
        codec.project(
          { value: 3 },
          {
            tenantId: "t",
            aggregateId: "a",
            version: codec.writes,
          },
        ).version,
      ).toBe("g3");
    });
  });

  describe("given one stamp that spans two row shapes", () => {
    // The codingAgentSession case: a migration shipped read-back columns
    // without moving the stamp, so the row itself is the only evidence of
    // which shape it is in.
    const codec = ladderCodec({
      generations: [
        { stamp: "g1", provenBy: (r) => r.checkpoint > 0 },
        { stamp: "g2" },
      ],
      readBackSince: 1,
    });

    /** @scenario one shape of record that says nothing about which build wrote it is settled by the record itself */
    it("reads a row of that stamp carrying its evidence", () => {
      expect(codec.readable(row({ version: "g1", checkpoint: 1_900 }))).toBe(
        true,
      );
    });

    it("refuses a row of the same stamp without the evidence", () => {
      expect(codec.readable(row({ version: "g1", checkpoint: 0 }))).toBe(false);
    });

    it("does not extend that evidence to any other stamp", () => {
      // A populated checkpoint rehabilitates only the ONE stamp known to
      // straddle the change; any other stamp is a shape never reasoned about.
      expect(codec.readable(row({ version: "gX", checkpoint: 1_900 }))).toBe(
        false,
      );
    });
  });

  describe("given a shape withdrawn between two readable ones", () => {
    const codec = ladderCodec({
      generations: [
        { stamp: "g1" },
        { stamp: "g2", withdrawn: "recorded the wrong counts" },
        { stamp: "g3" },
      ],
      readBackSince: 1,
    });

    /** @scenario a shape whose records are known to be wrong is rebuilt even though it can be read */
    it("refuses the withdrawn shape while reading the shapes either side", () => {
      expect(codec.readable(row({ version: "g2" }))).toBe(false);
      expect(codec.readable(row({ version: "g1" }))).toBe(true);
      expect(codec.readable(row({ version: "g3" }))).toBe(true);
    });
  });

  describe("given a declaration that could not be honoured", () => {
    /** @scenario a fold cannot claim to read back a shape it has withdrawn */
    it("rejects withdrawing the shape being written", () => {
      expect(() =>
        ladderCodec({
          generations: [{ stamp: "g1" }, { stamp: "g2", withdrawn: "wrong" }],
          readBackSince: 1,
        }),
      ).toThrow(/cannot write a shape it refuses to read/);
    });

    it("rejects a floor that names no declared shape", () => {
      expect(() => ladderCodec({ readBackSince: 4 })).toThrow(
        /readBackSince must name a declared generation/,
      );
    });

    it("rejects a stamp declared twice", () => {
      expect(() =>
        ladderCodec({
          generations: [{ stamp: "g1" }, { stamp: "g1" }],
          readBackSince: 1,
        }),
      ).toThrow(/declared twice/);
    });

    it("rejects an empty read-back list, which would disarm the ratchet", () => {
      expect(() => ladderCodec({ reads: [] })).toThrow(/disarms/);
    });

    it("rejects a ladder with no shapes at all", () => {
      expect(() => ladderCodec({ generations: [], readBackSince: 1 })).toThrow(
        /at least one generation/,
      );
    });
  });

  describe("given the read-back list is re-sorted but unchanged", () => {
    it("fingerprints the same, so re-ordering is not mistaken for a change", () => {
      const a = ladderCodec({ reads: ["B", "A", "C"] });
      const b = ladderCodec({ reads: ["A", "C", "B"] });
      expect(a.readsFingerprint).toBe(b.readsFingerprint);
    });

    it("fingerprints differently when a detail is added", () => {
      const a = ladderCodec({ reads: ["A", "B"] });
      const b = ladderCodec({ reads: ["A", "B", "C"] });
      expect(a.readsFingerprint).not.toBe(b.readsFingerprint);
    });
  });
});
