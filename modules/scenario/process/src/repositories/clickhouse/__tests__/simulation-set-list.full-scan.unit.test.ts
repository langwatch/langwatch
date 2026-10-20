/**
 * @vitest-environment node
 * Spec: modules/scenario/specs/simulation-run.feature
 */
import { describe, expect, it } from "vitest";

import { ClickHouseScenarioSession } from "../clickhouse.scenario-session.store.ts";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

type SentRead = { sql: string; SKIP_COLD_SCAN_CHECK?: true | undefined };

/** The repository over the real session adapter, keeping what reaches the routed member. */
function compose() {
  const sent: SentRead[] = [];
  const repository = SimulationClickHouseRepository.create(
    ClickHouseScenarioSession.resolverOver({
      query: async <Row>(request: SentRead) => {
        sent.push(request);
        return { rows: [] as Row[] };
      },
      columns: () => {
        throw new Error("the set list names its columns");
      },
    }),
  );
  return { repository, sent };
}

describe("SimulationClickHouseRepository.findScenarioSetsData()", () => {
  describe("given no start date", () => {
    /** @scenario "The scenario-set list with no start date is a declared full scan" */
    it("lists every set unbounded, as on main, declared a full scan", async () => {
      const { repository, sent } = compose();

      await repository.findScenarioSetsData({ projectId: "project-1" });

      expect(sent).toHaveLength(1);
      expect(sent[0]?.SKIP_COLD_SCAN_CHECK).toBe(true);
      expect(sent[0]?.sql).not.toContain("startDateMs");
    });
  });

  describe("given a start date", () => {
    /** @scenario "The scenario-set list with no start date is a declared full scan" */
    it("bounds the read by the date and declares nothing", async () => {
      const { repository, sent } = compose();

      await repository.findScenarioSetsData({
        projectId: "project-1",
        startDate: 1_700_000_000_000,
      });

      expect(sent[0]?.sql).toContain("startDateMs");
      expect(sent[0]?.SKIP_COLD_SCAN_CHECK).toBeUndefined();
    });
  });
});
