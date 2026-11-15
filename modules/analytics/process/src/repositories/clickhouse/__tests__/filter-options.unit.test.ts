import type { FilterField } from "@langwatch/analytics-contract";
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { clickHouseFilters } from "../clickhouse.filter-definitions.mapper.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse.filter-options.repository.ts";

/** Every filter field at once, the widest a dashboard's filter bar can narrow a picker by. */
const EVERY_FILTER = {
  "topics.topics": ["a"],
  "topics.subtopics": ["a"],
  "metadata.user_id": ["a"],
  "metadata.thread_id": ["a"],
  "metadata.customer_id": ["a"],
  "metadata.labels": ["a"],
  "metadata.key": ["a"],
  "metadata.value": { plan: ["a"] },
  "metadata.prompt_ids": ["a"],
  "traces.origin": ["application", "evaluation"],
  "traces.error": ["true"],
  "traces.name": ["a"],
  "spans.type": ["a"],
  "spans.model": ["a"],
  "evaluations.evaluator_id": ["a"],
  "evaluations.evaluator_id.guardrails_only": ["a"],
  "evaluations.evaluator_id.has_passed": ["a"],
  "evaluations.evaluator_id.has_score": ["a"],
  "evaluations.evaluator_id.has_label": ["a"],
  "evaluations.passed": { ev: ["true"] },
  "evaluations.score": { ev: ["0", "1"] },
  "evaluations.label": { ev: ["a"] },
  "evaluations.state": { ev: ["a"] },
  "events.event_type": ["a"],
  "events.metrics.key": { thumbs_up_down: ["a"] },
  "events.metrics.value": { thumbs_up_down: { vote: ["0", "1"] } },
  "events.event_details.key": { thumbs_up_down: ["a"] },
  "annotations.hasAnnotation": ["true"],
};

const FIELDS = (Object.keys(clickHouseFilters) as FilterField[]).filter(
  (field) => clickHouseFilters[field] !== null,
);

function repositoryOver() {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [] };
    },
  } as never;
  return { statements, repository: FilterOptionsClickHouseRepository.create({ clickhouse }) };
}

const ask = (field: FilterField, extra: object = {}) => ({
  field,
  startDate: 1_700_000_000_000,
  endDate: 1_700_086_400_000,
  key: "ev·1",
  subkey: "vote",
  query: "a",
  authorization: analyticsProof({ projectId: "project-1" }),
  ...extra,
});

describe("FilterOptionsClickHouseRepository", () => {
  describe("given the project's own proof", () => {
    it.each(FIELDS)("sends the %s picker as the reader with the proof's tenants", async (field) => {
      const { statements, repository } = repositoryOver();

      await repository.findOptions(ask(field));

      expect(statements).toHaveLength(1);
      expect(statements[0]?.identity).toBe("reader");
      expect(statements[0]?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
    });

    it("puts a middle dot in the key back as a dot before it is bound", async () => {
      const { statements, repository } = repositoryOver();

      await repository.findOptions(ask("metadata.value"));

      expect(JSON.stringify(statements[0]?.params)).toContain("ev.1");
    });
  });

  describe("given a picker that needs a key, asked without one", () => {
    it("reads nothing and offers nothing", async () => {
      const { statements, repository } = repositoryOver();

      const options = await repository.findOptions(
        ask("evaluations.label", { key: undefined, subkey: undefined }),
      );

      expect(options).toEqual([]);
      expect(statements).toHaveLength(0);
    });
  });

  describe("given every other filter at once on an aggregate's proof", () => {
    it.each(FIELDS)("keeps the %s picker under the 900-parameter budget", async (field) => {
      const { statements, repository } = repositoryOver();
      const authorization = analyticsProof({
        projectId: "aggregate-1",
        shared: [
          { projectId: "member-a", from: 0 },
          { projectId: "member-b", from: 1_600_000_000_000, until: 1_800_000_000_000 },
        ],
      });

      await repository.findOptions(
        ask(field, { filters: EVERY_FILTER, readsMembers: true, authorization }),
      );

      expect(Object.keys(statements[0]?.params ?? {}).length).toBeLessThan(900);
    });
  });
});
