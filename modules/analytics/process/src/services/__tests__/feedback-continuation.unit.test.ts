/**
 * The feedback history read one bounded page at a time: the order the pages follow, the end
 * state, what a cursor is tied to, and that the existing read is left as it was.
 * @vitest-environment node
 */
import {
  analyticsFeedbacksPageParamsSchema,
  analyticsFeedbacksPageResultSchema,
  type AnalyticsFeedbackEvent,
  type AnalyticsFeedbackPosition,
  type AnalyticsFeedbacksResult,
  type AnalyticsReadInput,
} from "@langwatch/analytics-contract";
import { InProcessTenantStatementLimiter } from "@langwatch/limiter";
import { describe, expect, it } from "vitest";

import { NullAnalyticsEvaluationRepository } from "../../repositories/analytics-persistence.repository.ts";
import {
  AnalyticsRepository,
  type AnalyticsFeedbackPageRead,
  type AnalyticsFeedbackPageReadInput,
  type AnalyticsLegacyReadInput,
} from "../../repositories/analytics.repository.ts";
import { AnalyticsService } from "../analytics.service.ts";

const PROJECT = "project-1";
const WINDOW = { startDate: 1_000, endDate: 9_000_000 };

/** The persisted identity of one feedback, plus the order a history lists it in. */
function newestFirst(a: AnalyticsFeedbackPosition, b: AnalyticsFeedbackPosition): number {
  return (
    b.startedAt - a.startedAt ||
    b.traceId.localeCompare(a.traceId) ||
    b.spanId.localeCompare(a.spanId) ||
    b.eventIndex - a.eventIndex
  );
}

function eventOf(position: AnalyticsFeedbackPosition): AnalyticsFeedbackEvent {
  return {
    event_id: position.spanId,
    event_type: "thumbs_up_down",
    project_id: PROJECT,
    trace_id: position.traceId,
    timestamps: {
      started_at: position.startedAt,
      inserted_at: position.startedAt,
      updated_at: position.startedAt,
    },
    metrics: [{ key: "vote", value: 1 }],
    event_details: [{ key: "index", value: String(position.eventIndex) }],
  };
}

/** The identity an event carries on the wire, so two events are told apart by it alone. */
function identityOf(event: AnalyticsFeedbackEvent): string {
  return [
    event.timestamps.started_at,
    event.trace_id,
    event.event_id,
    event.event_details?.[0]?.value,
  ].join("/");
}

/**
 * A history kept in memory with the ordering the ClickHouse query gives: strictly after the
 * cursor in the total order, one row of lookahead for the end state. The service is what is
 * under test, so the order is the double's one stated assumption and the builder test pins it.
 */
class HistoryRepository extends AnalyticsRepository {
  readonly pageReads: AnalyticsFeedbackPageReadInput[] = [];
  readonly legacyReads: AnalyticsLegacyReadInput[] = [];

  constructor(public history: AnalyticsFeedbackPosition[]) {
    super();
  }

  tableFor(): never {
    throw new Error("the feedback history never routes a timeseries");
  }

  runTimeseries(): never {
    throw new Error("the feedback history never runs a timeseries");
  }

  async findFeedbackEvents(input: AnalyticsLegacyReadInput): Promise<AnalyticsFeedbacksResult> {
    this.legacyReads.push(input);
    return { events: this.history.toSorted(newestFirst).slice(0, 100).map(eventOf) };
  }

  async findFeedbackEventsPage(
    input: AnalyticsFeedbackPageReadInput,
  ): Promise<AnalyticsFeedbackPageRead> {
    this.pageReads.push(input);
    const { after } = input;
    const ordered = [...this.history]
      .toSorted(newestFirst)
      .filter((position) => !after || newestFirst(after, position) < 0);
    return {
      rows: ordered
        .slice(0, input.limit)
        .map((position) => ({ event: eventOf(position), position })),
      hasMore: ordered.length > input.limit,
    };
  }

  findTopDocuments(): never {
    throw new Error("the feedback history never reads documents");
  }
}

function serviceOver(repository: AnalyticsRepository): AnalyticsService {
  return AnalyticsService.create({
    repository,
    evaluationRepository: NullAnalyticsEvaluationRepository.create(),
    tenantLimiter: new InProcessTenantStatementLimiter({
      maxConcurrent: 4,
      maxQueued: 64,
      waitTimeoutMs: 45_000,
      metricsInstance: "tenant-analytics-feedback-continuation-test",
      overloadErrorFactory: { create: ({ cause }: { cause: unknown }) => cause },
    }),
  });
}

function read(overrides: Partial<AnalyticsReadInput> = {}): AnalyticsReadInput {
  return { projectId: PROJECT, ...WINDOW, filters: {}, ...overrides };
}

/** Three traces, one with two feedbacks in a span and three events sharing one timestamp. */
const HISTORY: AnalyticsFeedbackPosition[] = [
  { startedAt: 5_000, traceId: "trace-a", spanId: "span-1", eventIndex: 1 },
  { startedAt: 5_000, traceId: "trace-a", spanId: "span-1", eventIndex: 2 },
  { startedAt: 5_000, traceId: "trace-a", spanId: "span-2", eventIndex: 1 },
  { startedAt: 5_000, traceId: "trace-b", spanId: "span-1", eventIndex: 1 },
  { startedAt: 4_000, traceId: "trace-b", spanId: "span-3", eventIndex: 1 },
  { startedAt: 3_000, traceId: "trace-c", spanId: "span-1", eventIndex: 1 },
  { startedAt: 2_000, traceId: "trace-a", spanId: "span-4", eventIndex: 1 },
  { startedAt: 1_500, traceId: "trace-c", spanId: "span-5", eventIndex: 1 },
];

describe("given a project's feedback history read a page at a time", () => {
  describe("when the first page is read", () => {
    /** @scenario "The first page is the newest feedbacks and says whether the history goes on" */
    it("returns the newest feedbacks up to the page size and the cursor of the next page", async () => {
      const repository = new HistoryRepository(HISTORY);

      const page = await serviceOver(repository).getFeedbacksPage({ ...read(), limit: 3 });

      expect(page.hasMore).toBe(true);
      expect(page.events.map(identityOf)).toEqual(
        [...HISTORY]
          .toSorted(newestFirst)
          .slice(0, 3)
          .map((position) => identityOf(eventOf(position))),
      );
      expect(page.hasMore && page.nextCursor.after).toEqual(HISTORY.toSorted(newestFirst)[2]);
      expect(analyticsFeedbacksPageResultSchema.validate(page)).toBe(true);
    });

    it("asks the repository for the newest page of the stated size from no position", async () => {
      const repository = new HistoryRepository(HISTORY);

      await serviceOver(repository).getFeedbacksPage({ ...read(), limit: 3 });

      expect(repository.pageReads).toEqual([{ ...read(), after: undefined, limit: 3 }]);
    });
  });

  describe("when the cursors are followed to the end", () => {
    /** @scenario "Following the cursors reads every feedback once, newest first" */
    it("lists every feedback once, in the unpaged order, including equal timestamps", async () => {
      const repository = new HistoryRepository(HISTORY);
      const service = serviceOver(repository);
      const seen: string[] = [];
      let page = await service.getFeedbacksPage({ ...read(), limit: 2 });
      seen.push(...page.events.map(identityOf));
      while (page.hasMore) {
        page = await service.getFeedbacksPage({ ...read(), limit: 2, cursor: page.nextCursor });
        seen.push(...page.events.map(identityOf));
      }

      const unpaged = await service.getFeedbacks(read());
      expect(seen).toEqual(unpaged.events.map(identityOf));
      expect(new Set(seen).size).toBe(HISTORY.length);
      expect("nextCursor" in page).toBe(false);
    });

    it("ends exactly when the history ends, not one page late", async () => {
      const repository = new HistoryRepository(HISTORY.slice(0, 4));

      const page = await serviceOver(repository).getFeedbacksPage({ ...read(), limit: 4 });

      expect(page.hasMore).toBe(false);
      expect(page.events).toHaveLength(4);
    });
  });

  describe("when the history fits one page or is empty", () => {
    /** @scenario "A history that fits one page, or is empty, has no next page" */
    it("returns what there is with no cursor", async () => {
      const service = serviceOver(new HistoryRepository(HISTORY.slice(0, 2)));

      const page = await service.getFeedbacksPage(read());

      expect(page.hasMore).toBe(false);
      expect(page.events).toHaveLength(2);
    });

    it("returns an empty end for a project with no feedbacks", async () => {
      const page = await serviceOver(new HistoryRepository([])).getFeedbacksPage(read());

      expect(page).toEqual({ hasMore: false, events: [] });
    });
  });

  describe("when the history changes between two pages", () => {
    /** @scenario "A feedback added or removed between pages neither repeats nor skips another" */
    it("continues after the same place whatever was added or removed around it", async () => {
      const repository = new HistoryRepository(HISTORY);
      const service = serviceOver(repository);
      const sorted = HISTORY.toSorted(newestFirst);
      const first = await service.getFeedbacksPage({ ...read(), limit: 3 });
      if (!first.hasMore) throw new Error("the first page of eight must have a next one");

      const newest = { startedAt: 8_000, traceId: "trace-z", spanId: "span-9", eventIndex: 1 };
      repository.history = [...HISTORY, newest].filter((position) => position !== sorted[2]);
      const second = await service.getFeedbacksPage({
        ...read(),
        limit: 3,
        cursor: first.nextCursor,
      });

      expect(second.events.map(identityOf)).toEqual(
        sorted.slice(3, 6).map((position) => identityOf(eventOf(position))),
      );
      expect(second.events.map(identityOf)).not.toContain(identityOf(eventOf(newest)));
    });
  });

  describe("when a cursor is used somewhere it was not issued", () => {
    async function issuedCursor(repository: HistoryRepository) {
      const first = await serviceOver(repository).getFeedbacksPage({
        ...read({ filters: { "metadata.labels": ["prod"] } }),
        limit: 2,
      });
      if (!first.hasMore) throw new Error("the first page must have a next one");
      return first.nextCursor;
    }

    /** @scenario "A cursor from another project or another filter set is refused" */
    it("refuses a cursor for another project and never reads", async () => {
      const repository = new HistoryRepository(HISTORY);
      const cursor = await issuedCursor(repository);
      repository.pageReads.length = 0;

      await expect(
        serviceOver(repository).getFeedbacksPage({
          ...read({ projectId: "project-2", filters: { "metadata.labels": ["prod"] } }),
          cursor,
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { cursor: expect.any(Array) } },
      });
      expect(repository.pageReads).toEqual([]);
    });

    it("refuses a cursor for other filters and never reads", async () => {
      const repository = new HistoryRepository(HISTORY);
      const cursor = await issuedCursor(repository);
      repository.pageReads.length = 0;

      await expect(
        serviceOver(repository).getFeedbacksPage({
          ...read({ filters: { "metadata.labels": ["staging"] } }),
          cursor,
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(repository.pageReads).toEqual([]);
    });

    it("accepts the same filters written in another key order and a window that moved", async () => {
      const repository = new HistoryRepository(HISTORY);
      const filters = { "metadata.labels": ["prod"], "metadata.user_id": ["u1"] };
      const first = await serviceOver(repository).getFeedbacksPage({
        ...read({ filters }),
        limit: 2,
      });
      if (!first.hasMore) throw new Error("the first page must have a next one");

      const second = await serviceOver(repository).getFeedbacksPage({
        ...read({
          filters: { "metadata.user_id": ["u1"], "metadata.labels": ["prod"] },
          endDate: WINDOW.endDate + 60_000,
        }),
        limit: 2,
        cursor: first.nextCursor,
      });

      expect(second.events).toHaveLength(2);
    });
  });

  describe("when the request is malformed", () => {
    /** @scenario "A malformed cursor or an out-of-range page size is refused" */
    it("rejects a cursor without a position and a page size outside the bounds", () => {
      const parse = (params: unknown) => analyticsFeedbacksPageParamsSchema.validate(params);

      expect([
        parse({ cursor: { scope: "s" } }),
        parse({ cursor: { scope: "s", after: { startedAt: 1, traceId: "t", spanId: "s" } } }),
        parse({
          cursor: { scope: "", after: { startedAt: 1, traceId: "t", spanId: "s", eventIndex: 1 } },
        }),
        parse({ limit: 0 }),
        parse({ limit: 101 }),
        parse({ limit: 1.5 }),
      ]).toEqual([false, false, false, false, false, false]);
      expect(parse({ limit: 100 })).toBe(true);
    });

    it("refuses a page size outside the bounds before any read", async () => {
      const repository = new HistoryRepository(HISTORY);

      await expect(
        serviceOver(repository).getFeedbacksPage({ ...read(), limit: 101 }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(repository.pageReads).toEqual([]);
    });
  });

  describe("when the existing feedback read is used", () => {
    /** @scenario "The existing feedback read keeps its query and result" */
    it("still reads the four stated fields through the old repository read, unpaged", async () => {
      const repository = new HistoryRepository(HISTORY);
      const filters = { "metadata.labels": ["prod"] };

      const result = await serviceOver(repository).getFeedbacks(read({ filters }));

      expect(repository.legacyReads).toEqual([{ projectId: PROJECT, ...WINDOW, filters }]);
      expect(repository.pageReads).toEqual([]);
      expect(Object.keys(result)).toEqual(["events"]);
    });
  });
});
