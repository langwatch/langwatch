/**
 * The wire is plain JSON. The transformer that used to wrap it cost 31.5 ms to
 * encode a 428 KB payload against JSON's 1.1 ms, and the extra types it
 * preserved were not worth that on a read path.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { createTrpcRoot } from "../../api.application.ts";

/** One instant, as a stored row would carry it out of Prisma. */
const STORED_AT = new Date("2026-09-06T10:11:12.000Z");

describe("given this process's tRPC root", () => {
  describe("when its runtime configuration is read", () => {
    /** @scenario "No transformer is configured on either side" */
    it("registers no data transformer", () => {
      const root = createTrpcRoot();

      // tRPC's own default. A registered transformer replaces this object,
      // so identity against the default is what proves none was registered.
      const untouched = initTRPC.create();

      expect(root._config.transformer).toStrictEqual(untouched._config.transformer);
      expect(root._config.transformer.output.serialize(STORED_AT)).toBe(STORED_AT);
    });
  });

  describe("when a procedure answers with an instant", () => {
    /** @scenario "An instant crosses the wire as an ISO 8601 string" */
    it("encodes it as an ISO 8601 string", () => {
      const root = createTrpcRoot();

      const encoded = JSON.stringify(root._config.transformer.output.serialize({ at: STORED_AT }));

      expect(JSON.parse(encoded)).toEqual({ at: "2026-09-06T10:11:12.000Z" });
    });
  });

  describe("when a procedure answers with a stored row carrying a timestamp column", () => {
    /** @scenario "A stored row's timestamp column arrives as a string" */
    it("hands the column over as a string a caller parses at the point of use", () => {
      const root = createTrpcRoot();
      const row = { id: "prompt_1", name: "greeting", createdAt: STORED_AT, archivedAt: null };

      const received = JSON.parse(
        JSON.stringify(root._config.transformer.output.serialize(row)),
      ) as { createdAt: string; archivedAt: null };

      expect(typeof received.createdAt).toBe("string");
      expect(received.archivedAt).toBeNull();
      expect(new Date(received.createdAt).getTime()).toBe(STORED_AT.getTime());
    });
  });
});
