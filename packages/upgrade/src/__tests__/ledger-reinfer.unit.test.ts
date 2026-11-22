/** @see packages/upgrade/specs/ledger-seed.feature */
import { describe, expect, it } from "vitest";

import { withReinferred } from "../ledger-seed.service.ts";

const history = [
  {
    id: "prisma:20261001000000_base",
    kind: "postgres-schema" as const,
    mode: "blocking" as const,
    status: "done" as const,
    lastError: null,
  },
  {
    id: "clickhouse:00001",
    kind: "clickhouse-schema" as const,
    mode: "blocking" as const,
    status: "done" as const,
    lastError: null,
  },
];

describe("withReinferred()", () => {
  describe("when the tools record a step the stale seed read as pending", () => {
    /** @scenario "A read-only plan reads seeded rows as the tools record them now" */
    it("takes the tools' status for inferred rows and keeps the runner's own rows", () => {
      const steps = withReinferred({
        steps: [
          { id: "prisma:20261001000000_base", status: "pending", inferred: true },
          { id: "clickhouse:00001", status: "failed", inferred: false },
          { id: "dataset:copy-keys", status: "pending", inferred: false },
        ],
        history,
      });
      expect(steps).toEqual([
        { id: "prisma:20261001000000_base", status: "done" },
        { id: "clickhouse:00001", status: "failed" },
        { id: "dataset:copy-keys", status: "pending" },
      ]);
    });

    it("adds a step only the tools record", () => {
      const steps = withReinferred({ steps: [], history });
      expect(steps.map(({ id }) => id)).toEqual(["prisma:20261001000000_base", "clickhouse:00001"]);
    });
  });
});
