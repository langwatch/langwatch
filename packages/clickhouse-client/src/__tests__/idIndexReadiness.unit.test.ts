/**
 * An owner's id-index readiness: the marker row, the empty-source shortcut, the background
 * re-check and the in-memory answer. Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it } from "vitest";

import { ID_INDEX_FILL_MARKER, IdIndexReadiness } from "../idIndexReadiness.ts";
import type { QueryRequest, QueryResult } from "../query.ts";

const SPANS = { source: "stored_spans", index: "stored_spans_id_index", key: ["TraceId"] };

/** A server holding, per target, whether its index has a marker row, and source rows. */
function serverWith({ marked, sourceRows }: { marked: boolean; sourceRows: boolean }) {
  const state = { marked, sourceRows, markedOn: new Set<string>() };
  const targetOf = (request: QueryRequest) => request.organizationId ?? "shared";
  const reads: QueryRequest[] = [];
  const writes: QueryRequest[] = [];
  const statements = {
    async query<Row>(request: QueryRequest): Promise<QueryResult<Row>> {
      reads.push(request);
      const found =
        request.table === SPANS.index
          ? state.marked || state.markedOn.has(targetOf(request))
          : state.sourceRows;
      return { rows: (found ? [{ ready: 1 }] : []) as Row[] };
    },
    async command(request: QueryRequest): Promise<void> {
      writes.push(request);
      state.markedOn.add(targetOf(request));
    },
  };
  return { state, reads, writes, statements };
}

/** Lets the background check started by `isOn` finish. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("IdIndexReadiness", () => {
  describe("given a target whose index holds the marker row", () => {
    it("is ready after the first check and never reads again", async () => {
      const server = serverWith({ marked: true, sourceRows: true });
      const readiness = IdIndexReadiness.create({
        statements: server.statements,
        indexes: [SPANS],
      });

      expect(readiness.isOn({ target: "shared" })).toBe(false);
      await settle();
      expect(readiness.isOn({ target: "shared" })).toBe(true);
      expect(readiness.isOn({ target: "shared" })).toBe(true);
      expect(server.reads).toHaveLength(1);
      expect(server.reads[0]).toMatchObject({
        tenantId: "",
        table: "stored_spans_id_index",
        params: { marker: ID_INDEX_FILL_MARKER },
        // The marker row belongs to no tenant: its TenantId is '', which no real tenant has.
        SKIP_TENANT_CHECK: true,
      });
      expect(server.writes).toEqual([]);
    });
  });

  describe("given an empty source and no marker", () => {
    /** @scenario "a fresh install with an empty table is ready at once" */
    it("writes the marker itself and is ready", async () => {
      const server = serverWith({ marked: false, sourceRows: false });
      const readiness = IdIndexReadiness.create({
        statements: server.statements,
        indexes: [SPANS],
      });

      expect(await readiness.check({ target: "org_private" })).toBe(true);
      expect(readiness.isOn({ target: "org_private" })).toBe(true);
      expect(server.writes).toEqual([
        expect.objectContaining({
          tenantId: "",
          organizationId: "org_private",
          sql:
            "INSERT INTO stored_spans_id_index (TenantId, TraceId, _retention_days) " +
            "VALUES ('', {marker:String}, 65535)",
          // The marker row belongs to no tenant: its TenantId is '', which no real tenant has.
          SKIP_TENANT_CHECK: true,
        }),
      ]);
    });
  });

  describe("given a source with rows and no marker", () => {
    /** @scenario "readers trust the index only once its marker row is written" */
    it("is not ready, re-checks at most every 60 s, and is ready once a marker appears", async () => {
      const server = serverWith({ marked: false, sourceRows: true });
      let clock = 0;
      const readiness = IdIndexReadiness.create({
        statements: server.statements,
        indexes: [SPANS],
        now: () => clock,
      });

      expect(readiness.isOn({ target: "shared" })).toBe(false);
      await settle();
      expect(server.reads).toHaveLength(2);

      clock = 59_999;
      for (let lookup = 0; lookup < 100; lookup += 1) {
        expect(readiness.isOn({ target: "shared" })).toBe(false);
      }
      await settle();
      expect(server.reads).toHaveLength(2);
      expect(server.writes).toEqual([]);

      server.state.marked = true;
      clock = 60_000;
      expect(readiness.isOn({ target: "shared" })).toBe(false);
      await settle();
      expect(readiness.isOn({ target: "shared" })).toBe(true);
      expect(server.reads).toHaveLength(3);
    });
  });

  describe("given targets to watch from boot", () => {
    it("checks each at once, so a fresh install is marked before its first row", async () => {
      const server = serverWith({ marked: false, sourceRows: false });
      const readiness = IdIndexReadiness.create({
        statements: server.statements,
        indexes: [SPANS],
        watch: () => ["shared", "org_private"],
      });
      await settle();

      expect(server.writes.map((write) => write.organizationId ?? "shared")).toEqual([
        "shared",
        "org_private",
      ]);
      expect(readiness.isOn({ target: "shared" })).toBe(true);
      expect(readiness.isOn({ target: "org_private" })).toBe(true);
    });
  });

  describe("given a check that fails", () => {
    it("reads as not ready", async () => {
      const readiness = IdIndexReadiness.create({
        statements: {
          query: () => Promise.reject(new Error("Code: 60. Unknown table")),
          command: () => Promise.resolve(),
        },
        indexes: [SPANS],
      });

      expect(await readiness.check({ target: "shared" })).toBe(false);
      expect(readiness.isOn({ target: "shared" })).toBe(false);
    });
  });
});
