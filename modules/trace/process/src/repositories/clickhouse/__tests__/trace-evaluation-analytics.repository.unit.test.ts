/**
 * The settings trace_evaluation_analytics writes and reads with, chosen by the quorum flag.
 * @see specs/trace/trace-evaluation-analytics.feature
 */
import { AuthorizedClickHouse, type QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceEvaluationAnalyticsWrite } from "../../../rules/trace-evaluation-analytics.rules.ts";
import { TraceEvaluationAnalyticsClickHouseRepository } from "../trace-evaluation-analytics.repository.ts";
import { capturingInsertClient } from "./clickhouse-test-helpers.ts";

const TENANT_ID = "project-quorum";
const authorization = ownProof({ projectId: TENANT_ID });

const write: TraceEvaluationAnalyticsWrite = {
  row: {
    tenantId: TENANT_ID,
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
  },
  sign: 1,
  revision: 1,
  updatedAtMs: 1_758_189_660_000,
  retentionDays: 30,
};

function repositoryWith({ readYourWrites }: { readYourWrites?: boolean }) {
  const { client, inserts } = capturingInsertClient();
  const reads: QueryRequest[] = [];
  const authorized = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      reads.push(request);
      return { rows: [] };
    },
  });
  const repository = TraceEvaluationAnalyticsClickHouseRepository.create({
    resolveClient: async () => client,
    clickhouse: new AuthorizedClickHouse({ resolveClient: async () => authorized }),
    ...(readYourWrites === undefined ? {} : { readYourWrites }),
  });
  return { repository, inserts, reads };
}

async function writeThenRead(repository: TraceEvaluationAnalyticsClickHouseRepository) {
  await repository.insertRows({ writes: [write] });
  await repository.findLiveRows({
    authorization,
    traceIds: ["trace-1"],
    occurredAtFromMs: 1_758_100_000_000,
  });
}

describe("TraceEvaluationAnalyticsClickHouseRepository", () => {
  describe("when the quorum flag is off", () => {
    /** @scenario "Evaluation rows keep async inserts and plain reads while the quorum flag is off" */
    it("inserts asynchronously and reads with no extra settings", async () => {
      const { repository, inserts, reads } = repositoryWith({});

      await writeThenRead(repository);

      expect(inserts.map((insert) => insert.clickhouse_settings)).toEqual([
        { async_insert: 1, wait_for_async_insert: 1 },
      ]);
      expect(reads).toHaveLength(1);
      expect(reads[0]?.settings).not.toHaveProperty("select_sequential_consistency");
    });
  });

  describe("when the quorum flag is on", () => {
    /** @scenario "Evaluation rows are written by quorum and read sequentially while the quorum flag is on" */
    it("inserts synchronously by quorum and reads sequentially consistent", async () => {
      const { repository, inserts, reads } = repositoryWith({ readYourWrites: true });

      await writeThenRead(repository);

      expect(inserts.map((insert) => insert.clickhouse_settings)).toEqual([
        {
          async_insert: 0,
          insert_quorum: "auto",
          insert_quorum_parallel: 0,
        },
      ]);
      expect(reads).toHaveLength(1);
      expect(reads[0]?.settings).toMatchObject({ select_sequential_consistency: 1 });
    });
  });
});
