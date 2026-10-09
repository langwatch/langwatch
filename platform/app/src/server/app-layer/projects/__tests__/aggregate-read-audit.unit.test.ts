/**
 * ADR-144 decision 9: every read of an aggregate is audited, once per actor
 * and aggregate per five minutes. The audit runs on every proof-bearing
 * request, so a per-process window keeps the second request in it from
 * reaching the database at all; the database's own dedup stays the guard
 * across processes.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type AggregateRead,
  type AggregateReadAudit,
  DedupedAggregateReadAudit,
} from "../aggregate-read-audit";

/** The window the enterprise wiring passes: the database dedup's own. */
const WINDOW_MS = 5 * 60 * 1000;

const read = (overrides: Partial<AggregateRead> = {}): AggregateRead => ({
  actorUserId: "ana",
  organizationId: "org_acme",
  aggregateProjectId: "proj_company_view",
  ...overrides,
});

function harness() {
  let nowMs = 1_800_000_000_000;
  const inner = {
    recordAggregateRead: vi.fn<AggregateReadAudit["recordAggregateRead"]>(
      async () => undefined,
    ),
  };
  const audit = new DedupedAggregateReadAudit({
    inner,
    windowMs: WINDOW_MS,
    now: () => nowMs,
  });
  return {
    inner,
    audit,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("DedupedAggregateReadAudit", () => {
  describe("when the same actor reads the same aggregate twice inside the window", () => {
    it("records once", async () => {
      const { inner, audit, advance } = harness();

      await audit.recordAggregateRead(read());
      advance(WINDOW_MS - 1);
      await audit.recordAggregateRead(read());

      expect(inner.recordAggregateRead).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the window has passed on the injected clock", () => {
    it("records again", async () => {
      const { inner, audit, advance } = harness();

      await audit.recordAggregateRead(read());
      advance(WINDOW_MS);
      await audit.recordAggregateRead(read());

      expect(inner.recordAggregateRead).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the requests of one page arrive together", () => {
    it("records once for all of them", async () => {
      const { inner, audit } = harness();

      await Promise.all([
        audit.recordAggregateRead(read()),
        audit.recordAggregateRead(read()),
        audit.recordAggregateRead(read()),
      ]);

      expect(inner.recordAggregateRead).toHaveBeenCalledTimes(1);
    });
  });

  describe("when another actor or another aggregate is read", () => {
    it("records each pair on its own", async () => {
      const { inner, audit } = harness();

      await audit.recordAggregateRead(read());
      await audit.recordAggregateRead(read({ actorUserId: "sam" }));
      await audit.recordAggregateRead(
        read({ aggregateProjectId: "proj_other_view" }),
      );

      expect(inner.recordAggregateRead).toHaveBeenCalledTimes(3);
    });
  });

  describe("when recording fails", () => {
    it("passes the failure on and remembers nothing, so the next read retries", async () => {
      const { inner, audit } = harness();
      inner.recordAggregateRead.mockRejectedValueOnce(new Error("db down"));

      await expect(audit.recordAggregateRead(read())).rejects.toThrow(
        "db down",
      );
      await audit.recordAggregateRead(read());

      expect(inner.recordAggregateRead).toHaveBeenCalledTimes(2);
    });
  });
});
