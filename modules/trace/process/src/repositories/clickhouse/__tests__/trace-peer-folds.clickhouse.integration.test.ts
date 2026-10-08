/**
 * Trace's peer fold stores over the real tables (00107, 00108): replacement-aware reads, removals
 * and tombstones. Spec: modules/trace/specs/trace-topic-names.feature,
 * modules/trace/specs/trace-annotations.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceAnnotationScoresRepository } from "../clickhouse.trace-annotation-scores.repository.ts";
import { ClickHouseTraceAnnotationsRepository } from "../clickhouse.trace-annotations.repository.ts";
import type { TraceClickHouseWriteResolver } from "../clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceTopicNamesRepository } from "../clickhouse.trace-topic-names.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

let resolve: TraceClickHouseWriteResolver;

describe.skipIf(!clickHouseConfigured)("trace's peer fold stores (integration)", () => {
  beforeAll(async () => {
    const ch: ClickHouseClient = await startMigratedTraceClickHouse();
    resolve = async () => ch as never;
  }, 120_000);

  describe("given a project's topics folded twice, the second a replace without one", () => {
    /** @scenario "A replace drops the topics it no longer carries" */
    it("reads back only the topic that stayed, and the fold state matches", async () => {
      const tenantId = `project-${nanoid()}`;
      const repository = ClickHouseTraceTopicNamesRepository.create(resolve);
      const context = { tenantId, aggregateId: tenantId } as never;
      await repository.store(
        {
          topics: [
            { id: "t1", name: "Billing", parentId: null },
            { id: "t2", name: "Refunds", parentId: "t1" },
          ],
          LastEventOccurredAt: 1_000,
        },
        context,
      );
      await repository.store(
        { topics: [{ id: "t1", name: "Billing", parentId: null }], LastEventOccurredAt: 2_000 },
        context,
      );

      await expect(
        repository.findNamesByIds({ projectId: tenantId, ids: ["t1", "t2"] }),
      ).resolves.toEqual(new Map([["t1", "Billing"]]));
      await expect(repository.get(tenantId, context)).resolves.toEqual({
        kind: "folded",
        state: {
          topics: [{ id: "t1", name: "Billing", parentId: null }],
          LastEventOccurredAt: 2_000,
        },
      });
    });
  });

  describe("given an annotation stored with content and then as a tombstone", () => {
    /** @scenario "A deleted annotation is not listed" */
    it("lists it while live and not once deleted", async () => {
      const tenantId = `project-${nanoid()}`;
      const repository = ClickHouseTraceAnnotationsRepository.create(resolve);
      const context = { tenantId, aggregateId: "annotation-1" } as never;
      const content = {
        comment: "looks right",
        isThumbsUp: true,
        expectedOutput: null,
        scoreOptions: { "score-1": { value: "5" } },
        anchorKind: null,
        anchorId: null,
        anchorPath: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      };
      const live = {
        annotationId: "annotation-1",
        traceId: "trace-1",
        content,
        deleted: false,
        revision: 1,
        LastEventOccurredAt: 1_000,
      };
      await repository.store(live, context);
      await expect(
        repository.findForTraces({ projectId: tenantId, traceIds: ["trace-1"] }),
      ).resolves.toEqual([{ ...content, id: "annotation-1", traceId: "trace-1" }]);
      await expect(repository.get("annotation-1", context)).resolves.toEqual({
        kind: "folded",
        state: live,
      });

      await repository.store({ ...live, deleted: true, revision: 2 }, context);
      await expect(
        repository.findForTraces({ projectId: tenantId, traceIds: ["trace-1"] }),
      ).resolves.toEqual([]);
    });
  });

  describe("given a score name stored and then renamed", () => {
    /** @scenario "A renamed score names its old results" */
    it("lists the newest name", async () => {
      const tenantId = `project-${nanoid()}`;
      const repository = ClickHouseTraceAnnotationScoresRepository.create(resolve);
      const context = { tenantId, aggregateId: "score-1" } as never;
      const base = { scoreId: "score-1", LastEventOccurredAt: 500 };
      await repository.store({ ...base, name: "quality", namedAt: 500, revision: 1 }, context);
      await repository.store({ ...base, name: "accuracy", namedAt: 900, revision: 2 }, context);

      await expect(repository.findScoreNames({ projectId: tenantId })).resolves.toEqual([
        { id: "score-1", name: "accuracy" },
      ]);
    });
  });
});
