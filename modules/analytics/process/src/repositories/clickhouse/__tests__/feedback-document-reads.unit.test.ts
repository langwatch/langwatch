import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

/** Every filter field at once, the widest a dashboard's filter bar can ask for. */
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

function repositoryOver(rows: unknown[] = []) {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows };
    },
  } as never;
  return { statements, repository: ClickHouseAnalyticsRepository.create({ clickhouse }) };
}

const input = (filters = {}) => ({
  projectId: "project-1",
  startDate: 1_700_000_000_000,
  endDate: 1_700_086_400_000,
  filters,
  authorization: analyticsProof({ projectId: "project-1", permission: "cost:view" }),
});

describe("ClickHouseAnalyticsRepository top documents and feedbacks", () => {
  describe("given the project's own cost proof", () => {
    it("sends each read as the reader with the proof's tenants in the setting", async () => {
      const { statements, repository } = repositoryOver();

      await repository.findTopDocuments(input());
      await repository.findFeedbackEvents(input());
      await repository.findFeedbackEventsPage({ ...input(), after: undefined, limit: 2 });

      expect(statements).toHaveLength(3);
      for (const statement of statements) {
        expect(statement.identity).toBe("reader");
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project-1" });
        expect(statement.sql).toContain("trace_summaries");
        expect(statement.sql).toContain("stored_spans");
      }
    });
  });

  describe("given a proof minted for another project", () => {
    it("refuses before reading anything", async () => {
      const { statements, repository } = repositoryOver();

      await expect(
        repository.findTopDocuments({ ...input(), projectId: "project-2" }),
      ).rejects.toMatchObject({ code: "analytics_proof_project_mismatch" });
      expect(statements).toHaveLength(0);
    });
  });

  describe("given every filter field at once", () => {
    it("stays inside the 900-parameter budget", async () => {
      const { statements, repository } = repositoryOver();

      await repository.findFeedbackEventsPage({
        ...input(EVERY_FILTER),
        after: { startedAt: 1, traceId: "t", spanId: "s", eventIndex: 1 },
        limit: 2,
      });

      expect(Object.keys(statements[0]?.params ?? {}).length).toBeLessThan(900);
    });
  });
});
