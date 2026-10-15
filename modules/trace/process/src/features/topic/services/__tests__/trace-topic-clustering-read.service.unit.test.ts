import { describe, expect, it } from "vitest";

import {
  type TraceClusteringSampleCounts,
  TraceClusteringSampleRepository,
  type TraceClusteringSampleRow,
} from "../../repositories/trace-clustering-sample.repository.ts";
import { TraceTopicClusteringReadService } from "../trace-topic-clustering-read.service.ts";

const NOW = 1_000 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type PageQuery = Parameters<TraceClusteringSampleRepository["findPageRows"]>[0];
type CountQuery = Parameters<TraceClusteringSampleRepository["countTraces"]>[0];

/** Answers fixed rows and remembers what it was asked. */
class RecordingClusteringSampleRepository extends TraceClusteringSampleRepository {
  readonly pageQueries: PageQuery[] = [];
  readonly countQueries: CountQuery[] = [];

  constructor(
    private readonly rows: TraceClusteringSampleRow[] = [],
    private readonly counts: TraceClusteringSampleCounts = { total: 0, recent: 0, assigned: 0 },
  ) {
    super();
  }

  async countTraces(input: CountQuery): Promise<TraceClusteringSampleCounts> {
    this.countQueries.push(input);
    return this.counts;
  }

  async findPageRows(input: PageQuery): Promise<TraceClusteringSampleRow[]> {
    this.pageQueries.push(input);
    return this.rows;
  }
}

function row(overrides: Partial<TraceClusteringSampleRow> = {}): TraceClusteringSampleRow {
  return {
    traceId: "trace-1",
    computedInput: JSON.stringify("How do I reset my password?"),
    topicId: null,
    subtopicId: null,
    occurredAtMs: 5_000,
    ...overrides,
  };
}

function reader(repository: RecordingClusteringSampleRepository) {
  return TraceTopicClusteringReadService.create({ repository, now: () => NOW });
}

const firstPage = {
  projectId: "project-1",
  isIncrementalProcessing: false,
  topicIds: [],
  subtopicIds: [],
};

describe("TraceTopicClusteringReadService", () => {
  describe("readCounts()", () => {
    it("counts a year of traces, thirty recent days of them, and those carrying a topic", async () => {
      const repository = new RecordingClusteringSampleRepository([], {
        total: 12,
        recent: 5,
        assigned: 3,
      });

      await expect(reader(repository).readCounts({ projectId: "project-1" })).resolves.toEqual({
        totalTracesCount: 12,
        recentTracesCount: 5,
        assignedTracesCount: 3,
      });
      expect(repository.countQueries).toEqual([
        {
          tenantId: "project-1",
          recentSinceMs: NOW - 30 * DAY_MS,
          windowStartMs: NOW - 365 * DAY_MS,
        },
      ]);
    });
  });

  describe("readPage()", () => {
    it("reads the hot forty-nine days only, for every trace on a batch run", async () => {
      const repository = new RecordingClusteringSampleRepository();

      await reader(repository).readPage({ ...firstPage, topicIds: ["topic-1"] });

      expect(repository.pageQueries).toEqual([
        { tenantId: "project-1", windowStartMs: NOW - 49 * DAY_MS },
      ]);
    });

    it("asks for traces outside the known topics on an incremental run, after the cursor", async () => {
      const repository = new RecordingClusteringSampleRepository();

      await reader(repository).readPage({
        ...firstPage,
        isIncrementalProcessing: true,
        topicIds: ["topic-1"],
        subtopicIds: ["subtopic-1"],
        searchAfter: [4_000, "trace-9"],
      });

      expect(repository.pageQueries[0]).toEqual({
        tenantId: "project-1",
        windowStartMs: NOW - 49 * DAY_MS,
        unassignedFrom: { topicIds: ["topic-1"], subtopicIds: ["subtopic-1"] },
        searchAfter: [4_000, "trace-9"],
      });
    });

    it("orders newest first, then by trace id, keeping one row per trace", async () => {
      const repository = new RecordingClusteringSampleRepository([
        row({ traceId: "trace-b", occurredAtMs: 5_000 }),
        row({ traceId: "trace-c", occurredAtMs: 9_000 }),
        row({ traceId: "trace-a", occurredAtMs: 5_000 }),
        row({ traceId: "trace-c", occurredAtMs: 9_000, computedInput: JSON.stringify("older") }),
      ]);

      const page = await reader(repository).readPage(firstPage);

      expect(page.traces.map((trace) => trace.trace_id)).toEqual(["trace-c", "trace-a", "trace-b"]);
      expect(page.lastSort).toEqual([5_000, "trace-b"]);
      expect(page.returnedCount).toBe(3);
    });

    it("skips a trace with no input but still counts it and moves the cursor past it", async () => {
      const repository = new RecordingClusteringSampleRepository([
        row({ traceId: "trace-a", occurredAtMs: 9_000 }),
        row({ traceId: "trace-b", occurredAtMs: 1_000, computedInput: null }),
      ]);

      const page = await reader(repository).readPage(firstPage);

      expect(page.traces.map((trace) => trace.trace_id)).toEqual(["trace-a"]);
      expect(page.returnedCount).toBe(2);
      expect(page.lastSort).toEqual([1_000, "trace-b"]);
    });

    it("answers no cursor for an empty page", async () => {
      const page = await reader(new RecordingClusteringSampleRepository()).readPage(firstPage);

      expect(page).toEqual({ traces: [], lastSort: undefined, returnedCount: 0 });
    });

    it("keeps a trace's topic only when the caller knows that topic", async () => {
      const repository = new RecordingClusteringSampleRepository([
        row({ traceId: "trace-a", topicId: "topic-1", subtopicId: "subtopic-gone" }),
        row({ traceId: "trace-b", topicId: "topic-gone", subtopicId: "subtopic-1" }),
      ]);

      const page = await reader(repository).readPage({
        ...firstPage,
        topicIds: ["topic-1"],
        subtopicIds: ["subtopic-1"],
      });

      expect(page.traces.map(({ topic_id, subtopic_id }) => [topic_id, subtopic_id])).toEqual([
        ["topic-1", null],
        [null, "subtopic-1"],
      ]);
    });

    it("cuts an input to 8192 characters", async () => {
      const repository = new RecordingClusteringSampleRepository([
        row({ computedInput: JSON.stringify("x".repeat(10_000)) }),
      ]);

      const page = await reader(repository).readPage(firstPage);

      expect(page.traces[0]?.input).toHaveLength(8192);
    });

    it.each([
      ["a JSON string", JSON.stringify("plain question"), "plain question"],
      [
        "a value wrapping an input",
        JSON.stringify({ value: JSON.stringify({ input: "inner" }) }),
        "inner",
      ],
      ["a bare value", JSON.stringify({ value: "just the value" }), "just the value"],
      ["an input field", JSON.stringify({ input: "the input" }), "the input"],
      [
        "any other object",
        JSON.stringify({ messages: ["hi"] }),
        JSON.stringify({ messages: ["hi"] }),
      ],
      ["text that is not JSON", "not json at all", "not json at all"],
    ])("reads the input out of %s", async (_shape, computedInput, expected) => {
      const repository = new RecordingClusteringSampleRepository([row({ computedInput })]);

      const page = await reader(repository).readPage(firstPage);

      expect(page.traces[0]?.input).toBe(expected);
    });
  });
});
