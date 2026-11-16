/**
 * The legacy list and summary reads on built statements (ADR-202), as the app reader, return the
 * rows main returned on 26.8, kept as literals, with another tenant reusing every trace id.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import {
  type MigratedAppReaderClickHouse,
  startMigratedAppReaderClickHouse,
} from "@langwatch/test-harness/clickhouse-app-reader";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { openProtections } from "../../../../../repositories/clickhouse/__tests__/open-protections.ts";
import { TRACE_ID_INDEXES } from "../../../../../repositories/clickhouse/clickhouse.trace-id-indexes.database.ts";
import { compileLangWatchQLTraceCondition } from "../../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import {
  type LegacyFilterReads,
  legacyFilterAnswers,
  legacyFilterTenantsOf,
  seedLegacyFilterRows,
} from "./support/legacy-filter-cases.support.ts";
import { fencedOver } from "./support/legacy-trace-mapping.support.ts";

const BASE = Date.now() - 60 * 60_000;
const tenants = legacyFilterTenantsOf({ run: nanoid(6) });

let ch: MigratedAppReaderClickHouse;
let reads: LegacyFilterReads;

beforeAll(async () => {
  ch = await startMigratedAppReaderClickHouse({
    suite: "trace-legacy-filters",
    indexes: TRACE_ID_INDEXES,
    environment: process.env,
  });
  await seedLegacyFilterRows({
    tenants,
    base: BASE,
    insert: (table, values) => ch.admin.insert({ table, values, format: "JSONEachRow" }),
  });
  const repo = TraceLegacyReadClickHouseRepository.create({
    reader: ch.reader,
    clickhouse: fencedOver(async () => ch.readerConnection),
  });
  const ownRead = ownProof({ projectId: tenants.own });
  reads = {
    list: async ({ input, dateField, scrollId }) => {
      const page = await repo.listAllTracesForProject({
        input,
        protections: openProtections,
        options: { dateField, ...(scrollId ? { scrollId } : {}) },
        retentionDays: undefined,
        ownRead,
      });
      return {
        ids: page.summaries.map((summary) => summary.traceId),
        totalHits: page.totalHits,
        scrollId: page.scrollId,
      };
    },
    summaries: async ({ filter, dateField, scrollId, window }) => {
      const page = await repo.findTraceSummaries(
        { projectId: tenants.own, ...window, pageSize: 2 },
        {
          dateField,
          ...(scrollId ? { scrollId } : {}),
          compileFilter: () => compileLangWatchQLTraceCondition({ filter }),
        },
      );
      return { ids: page.summaries.map((summary) => summary.traceId), scrollId: page.scrollId };
    },
  };
}, 300_000);

afterAll(async () => {
  await ch?.close();
});

/** Main's answers on 26.8 (9dc790af47's text path), captured once and kept as literals. */
const MAIN: Record<string, unknown> = {
  "none:occurred": {
    pages: [
      ["t1", "t2"],
      ["t3", "t4"],
    ],
    totalHits: 4,
  },
  "metadata.user_id:occurred": { pages: [["t1", "t3"]], totalHits: 2 },
  "metadata.customer_id:occurred": { pages: [["t1"]], totalHits: 1 },
  "metadata.thread_id:occurred": { pages: [["t1"]], totalHits: 1 },
  "metadata.labels:occurred": { pages: [["t1", "t2"]], totalHits: 2 },
  "metadata.key:occurred": { pages: [["t1", "t3"]], totalHits: 2 },
  "metadata.value:occurred": { pages: [["t3"]], totalHits: 1 },
  "metadata.prompt_ids:occurred": { pages: [["t4"]], totalHits: 1 },
  "traces.origin application:occurred": { pages: [["t1", "t4"]], totalHits: 2 },
  "traces.origin named:occurred": { pages: [["t2", "t3"]], totalHits: 2 },
  "traces.error:occurred": { pages: [["t2", "t4"]], totalHits: 2 },
  "traces.name:occurred": { pages: [["t2"]], totalHits: 1 },
  "topics.topics:occurred": { pages: [["t1"]], totalHits: 1 },
  "spans.model:occurred": { pages: [["t2", "t4"]], totalHits: 2 },
  "annotations.hasAnnotation false:occurred": { pages: [["t1", "t2"], ["t3"]], totalHits: 3 },
  "spans.type:occurred": { pages: [["t2"]], totalHits: 1 },
  "evaluations.evaluator_id:occurred": { pages: [["t1", "t2"], ["t3"]], totalHits: 3 },
  "evaluations.evaluator_id.guardrails_only:occurred": { pages: [["t2"]], totalHits: 1 },
  "evaluations.evaluator_id.has_score:occurred": { pages: [["t1", "t2"]], totalHits: 2 },
  "evaluations.passed:occurred": { pages: [["t2"]], totalHits: 1 },
  "evaluations.score:occurred": { pages: [["t1"]], totalHits: 1 },
  "evaluations.label:occurred": { pages: [["t1"]], totalHits: 1 },
  "evaluations.state:occurred": { pages: [["t3"]], totalHits: 1 },
  "events.event_type:occurred": { pages: [["t1"]], totalHits: 1 },
  "events.metrics.key:occurred": { pages: [["t1"]], totalHits: 1 },
  "events.metrics.value:occurred": { pages: [["t1"]], totalHits: 1 },
  "events.event_details.key:occurred": { pages: [["t3"]], totalHits: 1 },
  "user and error:occurred": { pages: [["t1", "t3"]], totalHits: 2 },
  "search:occurred": { pages: [["t2", "t4"]], totalHits: 2 },
  "trace ids:occurred": { pages: [["t1", "t2"]], totalHits: 2 },
  "summary user:u1:occurred": {
    pages: [
      ["t3", "t1"],
      ["t3", "t1"],
      ["t3", "t1"],
      ["t3", "t1"],
      ["t3", "t1"],
      ["t3", "t1"],
    ],
  },
  "summary origin:evaluation OR traceName:search:occurred": {
    pages: [
      ["t4", "t2"],
      ["t4", "t2"],
      ["t4", "t2"],
      ["t4", "t2"],
      ["t4", "t2"],
      ["t4", "t2"],
    ],
  },
  "none:updated": {
    pages: [
      ["t1", "t2"],
      ["t3", "t4"],
    ],
    totalHits: 4,
  },
  "metadata.user_id:updated": { pages: [["t1", "t3"]], totalHits: 2 },
  "metadata.customer_id:updated": { pages: [["t1"]], totalHits: 1 },
  "metadata.thread_id:updated": { pages: [["t1"]], totalHits: 1 },
  "metadata.labels:updated": { pages: [["t1", "t2"]], totalHits: 2 },
  "metadata.key:updated": { pages: [["t1", "t3"]], totalHits: 2 },
  "metadata.value:updated": { pages: [["t3"]], totalHits: 1 },
  "metadata.prompt_ids:updated": { pages: [["t4"]], totalHits: 1 },
  "traces.origin application:updated": { pages: [["t1", "t4"]], totalHits: 2 },
  "traces.origin named:updated": { pages: [["t2", "t3"]], totalHits: 2 },
  "traces.error:updated": { pages: [["t2", "t4"]], totalHits: 2 },
  "traces.name:updated": { pages: [["t2"]], totalHits: 1 },
  "topics.topics:updated": { pages: [["t1"]], totalHits: 1 },
  "spans.model:updated": { pages: [["t2", "t4"]], totalHits: 2 },
  "annotations.hasAnnotation false:updated": { pages: [["t1", "t2"], ["t3"]], totalHits: 3 },
  "spans.type:updated": { pages: [["t2"]], totalHits: 1 },
  "evaluations.evaluator_id:updated": { pages: [["t1", "t2"], ["t3"]], totalHits: 3 },
  "evaluations.evaluator_id.guardrails_only:updated": { pages: [["t2"]], totalHits: 1 },
  "evaluations.evaluator_id.has_score:updated": { pages: [["t1", "t2"]], totalHits: 2 },
  "evaluations.passed:updated": { pages: [["t2"]], totalHits: 1 },
  "evaluations.score:updated": { pages: [["t1"]], totalHits: 1 },
  "evaluations.label:updated": { pages: [["t1"]], totalHits: 1 },
  "evaluations.state:updated": { pages: [["t3"]], totalHits: 1 },
  "events.event_type:updated": { pages: [["t1"]], totalHits: 1 },
  "events.metrics.key:updated": { pages: [["t1"]], totalHits: 1 },
  "events.metrics.value:updated": { pages: [["t1"]], totalHits: 1 },
  "events.event_details.key:updated": { pages: [["t3"]], totalHits: 1 },
  "user and error:updated": { pages: [["t1", "t3"]], totalHits: 2 },
  "search:updated": { pages: [["t2", "t4"]], totalHits: 2 },
  "trace ids:updated": { pages: [["t1", "t2"]], totalHits: 2 },
  "summary user:u1:updated": { pages: [["t3", "t1"]] },
  "summary origin:evaluation OR traceName:search:updated": { pages: [["t4", "t2"]] },
};

describe("the legacy filtered reads on built statements", () => {
  /** @scenario "Legacy filtered reads keep main's rows with another tenant sharing trace ids" */
  it("lists, counts and pages every legacy filter family as main did", async () => {
    const built = await legacyFilterAnswers({ reads, projectId: tenants.own, base: BASE });
    expect(built).toEqual(MAIN);
  });
});
