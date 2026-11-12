/**
 * The quorum flag reaches the evaluation repository through the Postgres factory, not only
 * when the repository is built by hand.
 * @see specs/trace/trace-evaluation-analytics.feature
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import type { TraceEvaluationAnalyticsWrite } from "../../../rules/trace-evaluation-analytics.rules.ts";
import { PostgresTraceRepositories } from "../../prisma/prisma.trace.repositories.ts";

const write: TraceEvaluationAnalyticsWrite = {
  row: {
    tenantId: "project-quorum-wiring",
    traceId: "trace-1",
    evaluationId: "evaluation-1",
    occurredAtMs: 1_758_189_660_000,
    traceOccurredAtMs: 1_758_189_600_000,
    evaluatorName: "Faithfulness",
    status: "processed",
    isGuardrail: false,
    passed: true,
    label: null,
    origin: null,
    traceOrigin: "application",
    customerId: null,
    topicId: null,
    labels: [],
    metadataTopic: "",
    metadataDocumentType: "",
    metadataLanguage: "",
    metadataTeam: "",
    metadataFlow: "",
    metadataSegment: "",
    metadataPromptVersion: "",
    occurredAtFromMs: 1_758_100_000_000,
  },
  sign: 1,
  revision: 1,
  updatedAtMs: 1_758_189_660_000,
  retentionDays: 30,
};

/** Records the settings each insert carries; the ClickHouse client is the only boundary faked. */
function evaluationAnalyticsWith({ quorum }: { quorum: boolean }) {
  const settings: unknown[] = [];
  const clickhouse: ClickHouseQueryClient = clickHouseQueryClientDouble({
    insert: async (input: { settings?: unknown }) => {
      settings.push(input.settings);
      return undefined;
    },
  });
  const repositories = PostgresTraceRepositories.create({
    prisma: {} as PrismaClient,
    clickhouse,
    evaluationAnalyticsQuorumReads: quorum,
  });
  return { evaluationAnalytics: repositories.evaluationAnalytics, settings };
}

describe("PostgresTraceRepositories evaluation analytics quorum wiring", () => {
  describe("when TRACE_EVALUATION_ANALYTICS_QUORUM_READS is off", () => {
    /** @scenario "Evaluation rows keep async inserts and plain reads while the quorum flag is off" */
    it("writes asynchronously", async () => {
      const { evaluationAnalytics, settings } = evaluationAnalyticsWith({ quorum: false });

      await evaluationAnalytics.insertRows({ writes: [write] });

      expect(settings).toEqual([{ async_insert: 1, wait_for_async_insert: 1 }]);
    });
  });

  describe("when TRACE_EVALUATION_ANALYTICS_QUORUM_READS is on", () => {
    /** @scenario "Evaluation rows are written by quorum and read sequentially while the quorum flag is on" */
    it("writes by quorum", async () => {
      const { evaluationAnalytics, settings } = evaluationAnalyticsWith({ quorum: true });

      await evaluationAnalytics.insertRows({ writes: [write] });

      expect(settings).toEqual([
        { async_insert: 0, insert_quorum: "auto", insert_quorum_parallel: 0 },
      ]);
    });
  });
});
