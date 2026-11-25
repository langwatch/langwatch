import { describe, expect, it } from "vitest";

import { gooseSteps, prismaSteps } from "../seed-sources.ts";

describe("prismaSteps()", () => {
  describe("when a migration failed and was later re-applied", () => {
    it("reads it as done with no error", () => {
      expect(
        prismaSteps({
          rows: [
            { migration_name: "1_x", finished: false, rolled_back: true, logs: "boom" },
            { migration_name: "1_x", finished: true, rolled_back: false, logs: null },
          ],
        }),
      ).toEqual([
        {
          id: "prisma:1_x",
          kind: "postgres-schema",
          mode: "blocking",
          status: "done",
          lastError: null,
        },
      ]);
    });
  });
});

describe("gooseSteps()", () => {
  describe("when ClickHouse answers Int64 versions as strings", () => {
    it("pads the version to five digits and skips the bootstrap version", () => {
      expect(
        gooseSteps({
          rows: [
            { version_id: "0", is_applied: 1 },
            { version_id: "104", is_applied: 1 },
          ],
        }).map((step) => step.id),
      ).toEqual(["clickhouse:00104"]);
    });
  });
});
