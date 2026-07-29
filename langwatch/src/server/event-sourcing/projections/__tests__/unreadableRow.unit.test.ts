import { describe, expect, it, vi } from "vitest";
import { QueryMemoryExceededError } from "~/server/app-layer/traces/errors";
import { isUnreadableColumnError } from "../../services/errorHandling";
import { readBackOrUnreadable, UNREADABLE_ROW } from "../unreadableRow";

/**
 * The permanent-versus-transient split behind
 * `specs/clickhouse/unreadable-row-recovery.feature`.
 *
 * Both sides matter equally. Classifying too narrowly leaves the read throwing
 * and the group wedged; classifying too broadly turns an ordinary ClickHouse
 * overload into an unbounded `event_log` re-fold on every event — the
 * cold-scan behaviour the read-back exists to retire.
 */

/** The shape the ClickHouse driver raises for an undecodable column. */
function unreadableColumnError(column = "AnnotationIds"): Error {
  const error = new Error(
    `Amount of memory requested to allocate is more than allowed: ` +
      `(while reading column ${column}): (while reading from part ` +
      `/var/lib/clickhouse/data/store/95c/abc/202629_0_387304_1998/ in table ` +
      `langwatch.trace_analytics located on disk local of type local, ` +
      `from mark 8 with max_rows_to_read = 1, offset = 44). `,
  );
  (error as Error & { code: string }).code = "173";
  return error;
}

describe("isUnreadableColumnError", () => {
  describe("given a column that cannot be decoded", () => {
    it("recognises it", () => {
      expect(isUnreadableColumnError(unreadableColumnError())).toBe(true);
    });

    it("recognises it through a handled error's reasons", () => {
      const wrapped = new QueryMemoryExceededError({
        reasons: [unreadableColumnError()],
      });
      expect(isUnreadableColumnError(wrapped)).toBe(true);
    });
  });

  describe("given a failure that is worth retrying", () => {
    it("rejects a genuine per-query memory-limit overrun", () => {
      const error = new Error(
        "Memory limit (for query) exceeded: would use 9.31 GiB. MEMORY_LIMIT_EXCEEDED",
      );
      (error as Error & { code: string }).code = "241";
      expect(isUnreadableColumnError(error)).toBe(false);
    });

    it("rejects an allocation failure that is not decoding a column", () => {
      // Same code 173, but nothing says a column was being read — this is the
      // server genuinely unable to serve an allocation, which frees up.
      const error = new Error(
        "Amount of memory requested to allocate is more than allowed",
      );
      (error as Error & { code: string }).code = "173";
      expect(isUnreadableColumnError(error)).toBe(false);
    });

    it("rejects a connection-level failure", () => {
      const error = new Error("connect ECONNREFUSED 10.0.0.1:8123");
      (error as Error & { code: string }).code = "ECONNREFUSED";
      expect(isUnreadableColumnError(error)).toBe(false);
    });

    it("rejects a non-error value", () => {
      expect(isUnreadableColumnError("nope")).toBe(false);
      expect(isUnreadableColumnError(null)).toBe(false);
    });
  });
});

describe("readBackOrUnreadable", () => {
  describe("when the read succeeds", () => {
    it("returns the row unchanged", async () => {
      const row = { traceId: "trace-1" };
      await expect(readBackOrUnreadable(async () => row)).resolves.toBe(row);
    });

    it("returns null unchanged, which is a genuinely absent row", async () => {
      await expect(readBackOrUnreadable(async () => null)).resolves.toBeNull();
    });
  });

  describe("when the row cannot be decoded", () => {
    it("answers with the sentinel instead of throwing", async () => {
      await expect(
        readBackOrUnreadable(async () => {
          throw unreadableColumnError();
        }),
      ).resolves.toBe(UNREADABLE_ROW);
    });
  });

  describe("when the read fails for any other reason", () => {
    it("propagates so the queue redelivers the job", async () => {
      const boom = new Error("connect ETIMEDOUT");
      (boom as Error & { code: string }).code = "ETIMEDOUT";
      await expect(
        readBackOrUnreadable(async () => {
          throw boom;
        }),
      ).rejects.toBe(boom);
    });

    it("does not swallow a programming error", async () => {
      const bug = new TypeError("x is not a function");
      await expect(
        readBackOrUnreadable(async () => {
          throw bug;
        }),
      ).rejects.toBe(bug);
    });
  });

  describe("when the read succeeds on its own", () => {
    it("runs the read exactly once", async () => {
      const read = vi.fn(async () => ({ ok: true }));
      await readBackOrUnreadable(read);
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
});
