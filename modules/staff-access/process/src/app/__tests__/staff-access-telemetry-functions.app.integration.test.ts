/**
 * The telemetry ops functions through the staff access module, over memory twins and stand-in
 * peers (see support/): ops answers the ClickHouse reads.
 * @see modules/staff-access/specs/staff-access-functions-telemetry.feature
 */
import type { StaffAccessDoorSession } from "@langwatch/staff-access-contract";
import { describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import {
  ACME,
  requestBody,
  staffAccessWorld,
  codeOf,
  redeemedSession,
} from "./support/staff-access-world.ts";

const world = () => staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create() });

/** A redeemed `ops:read` session naming `functions`, as the door identifies its ops token. */
function opsReadSession(
  w: ReturnType<typeof world>,
  functions: string[],
): Promise<StaffAccessDoorSession> {
  return redeemedSession({ world: w, scopes: ["ops:read"], functions });
}

describe("the telemetry ops functions", () => {
  describe("when an ops:read session reads failed ClickHouse statements", () => {
    /** @scenario "ch.query_errors groups failed statements by shape, source and code" */
    it("answers a page of groups with shape, source, code, count and projects", async () => {
      const w = world();
      const session = await opsReadSession(w, ["ch.query_errors"]);

      const answered = await w.app.callFunction({
        session,
        name: "ch.query_errors",
        input: { since: "2026-11-01T10:00:00Z" },
      });

      expect(answered.output).toEqual({
        items: [
          {
            queryShapeId: "1234567890",
            source: "lwql",
            code: 241,
            codeName: "MEMORY_LIMIT_EXCEEDED",
            count: 5,
            p95Ms: 812,
            maxMemoryBytes: 10_000_000,
            rowsRead: 4_000,
            projectIds: [`${ACME.id}_project`],
            lastAt: "2026-11-02T09:45:00.000Z",
          },
        ],
        total: 1,
        truncated: false,
        nextCursor: null,
      });
      expect(w.state.clickHouseErrorAsks).toEqual([
        {
          sinceMs: Date.parse("2026-11-01T10:00:00Z"),
          untilMs: Date.parse("2026-11-02T10:00:00Z"),
        },
      ]);
    });

    /** @scenario "ch.query_errors narrows to one source or one error code" */
    it("asks ops for the source and code named", async () => {
      const w = world();
      const session = await opsReadSession(w, ["ch.query_errors"]);

      await w.app.callFunction({
        session,
        name: "ch.query_errors",
        input: { since: "2026-11-02T09:00:00Z", source: "dashboard", code: 159 },
      });

      expect(w.state.clickHouseErrorAsks).toMatchObject([{ source: "dashboard", code: 159 }]);
    });

    /** @scenario "ch.query_errors refuses a range over seven days" */
    it("refuses eight days and asks ops nothing", async () => {
      const w = world();
      const session = await opsReadSession(w, ["ch.query_errors"]);

      const code = await codeOf(
        w.app.callFunction({
          session,
          name: "ch.query_errors",
          input: { since: "2026-10-25T10:00:00Z" },
        }),
      );

      expect(code).toBe("staff_function_bad_input");
      expect(w.state.clickHouseErrorAsks).toEqual([]);
    });
  });

  describe("when an organization session names a telemetry function", () => {
    /** @scenario "Telemetry functions are not reachable from an organization session" */
    it("refuses the request with staff_function_scope_mismatch", async () => {
      const w = world();
      const agent = await w.enrol();

      const code = await codeOf(
        w.app.createRequest({
          session: agent.session,
          body: requestBody({ scopes: ["org:metadata"], functions: ["ch.query_errors"] }),
        }),
      );

      expect(code).toBe("staff_function_scope_mismatch");
    });
  });

  describe("when an ops:read session reads ClickHouse's health", () => {
    /** @scenario "ch.health answers replicas, merges, disks, memory and a page of tables" */
    it("answers the figures and pages the tables", async () => {
      const w = world();
      const session = await opsReadSession(w, ["ch.health"]);

      const first = await w.app.callFunction({ session, name: "ch.health", input: { limit: 1 } });
      const health = first.output as {
        nodes: number;
        disks: { lowestFreeRatio: number };
        tables: { items: { table: string }[]; total: number; nextCursor: string | null };
      };

      expect(health).toMatchObject({
        nodes: 2,
        replicas: { tables: 4, readonly: 0, maxQueueSize: 3 },
        merges: { running: 1, longestSeconds: 12 },
        disks: { count: 2, freeBytes: 400, lowestFreeRatio: 0.3 },
        memory: { residentBytes: 600, totalBytes: 1_000 },
        tables: { total: 2, truncated: true, items: [{ table: "stored_spans", activeParts: 40 }] },
      });
      const rest = await w.app.callFunction({
        session,
        name: "ch.health",
        input: { limit: 1, cursor: health.tables.nextCursor ?? "" },
      });
      expect(rest.output).toMatchObject({
        tables: { truncated: false, nextCursor: null, items: [{ table: "trace_summaries" }] },
      });
    });
  });
});
