/**
 * The synchronous query hydrates its extraction calls before it answers, as main's did
 * (Alex, 2026-10-06, "Inline eval"); diagnostics describe the hydrated answer.
 * @see specs/lwql/app-functions.feature
 */
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { DEFAULT_LWQL_HYDRATION_LIMITS } from "../../rules/langwatch-ql-hydration-assembly.rules.ts";
import {
  LangWatchQLHydrationComputeService,
  type LangWatchQLTraceRenderer,
} from "../langwatch-ql-hydration-compute.service.ts";
import {
  LangWatchQLHydrationReadService,
  type LangWatchQLTraceSource,
} from "../langwatch-ql-hydration-read.service.ts";
import { LangWatchQLHydrationService } from "../langwatch-ql-hydration.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const TRANSCRIPT = "### the transcript";

const EVERYTHING_VISIBLE = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

function trace({ id, threadId }: { id: string; threadId: string }): Trace {
  return {
    trace_id: id,
    project_id: "project-1",
    metadata: { thread_id: threadId },
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    spans: [],
  };
}

const renderer: LangWatchQLTraceRenderer = {
  renderThreadTranscript: async () => TRANSCRIPT,
  renderReadableTrace: async () => "the digest",
  renderTraceMessages: async () => "{}",
  renderSpanMessages: async () => ({ isSpanPresent: true, json: "{}" }),
  renderTraceJson: async () => "{}",
};

/** Holds one conversation, `thread-a`; every other key matches nothing. */
const traceSource: LangWatchQLTraceSource = {
  readTraces: async () => [],
  readThreadTraces: async ({ threadKeys }) =>
    threadKeys.includes("thread-a") ? [trace({ id: "trace-a", threadId: "thread-a" })] : [],
};

/** Answers with the keys it was given under one column, as the identity UDF does. */
class KeyAnsweringExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly keys: readonly string[]) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);
    const rows = this.keys.map((key) => ({ TraceId: `trace-of-${key}`, transcript: key }));

    return Promise.resolve({
      columns: [
        { name: "TraceId", type: "String" },
        { name: "transcript", type: "String" },
      ],
      rows,
      statistics: { elapsedMs: 1, rowsRead: 10, bytesRead: 10, rowsReturned: rows.length },
    });
  }
}

function serviceOver({
  keys,
  maxHydratedValueBytes = DEFAULT_LWQL_HYDRATION_LIMITS.maxHydratedValueBytes,
}: {
  keys: readonly string[];
  maxHydratedValueBytes?: number;
}): LangWatchQLService {
  const hydration = LangWatchQLHydrationService.create({
    reads: LangWatchQLHydrationReadService.create({ traces: traceSource }),
    compute: LangWatchQLHydrationComputeService.create({ renderer }),
    runner: {
      executeLangWatchQLPass: () => Promise.reject(new Error("the sync path reads no pass")),
    },
    limits: { ...DEFAULT_LWQL_HYDRATION_LIMITS, maxHydratedValueBytes },
  });

  return LangWatchQLService.create({
    executor: new KeyAnsweringExecutor(keys),
    database: "analytics",
    hydration,
  });
}

function query({ service, sql }: { service: LangWatchQLService; sql: string }) {
  return service.executeForProjects({
    projects: [{ id: "project-1", lwqlKey: "key-1" }],
    protections: EVERYTHING_VISIBLE,
    sql,
  });
}

const CONVERSATION_QUERY =
  "SELECT TraceId, conversation(ConversationId) AS transcript FROM analytics.trace_metrics";

describe("LangWatchQLService.executeForProjects with an extraction function", () => {
  describe("when the conversation key names a recorded thread", () => {
    /** @scenario "The hydrated column carries the rendered conversation, not the thread key" */
    it("answers with the rendered conversation in place of the key", async () => {
      const result = await query({
        service: serviceOver({ keys: ["thread-a"] }),
        sql: CONVERSATION_QUERY,
      });

      expect(result.rows).toEqual([{ TraceId: "trace-of-thread-a", transcript: TRANSCRIPT }]);
      expect(result.statistics.rowsReturned).toBe(1);
    });
  });

  describe("when a conversation key matches nothing", () => {
    /** @scenario "A key that resolves to nothing hydrates to null and is reported" */
    it("answers null for that row and reports APP_FUNCTION_UNRESOLVED_KEYS", async () => {
      const result = await query({
        service: serviceOver({ keys: ["thread-a", "thread-missing"] }),
        sql: CONVERSATION_QUERY,
      });

      expect(result.rows.map((row) => row.transcript)).toEqual([TRANSCRIPT, null]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "APP_FUNCTION_UNRESOLVED_KEYS",
          meta: { columns: [{ column: "transcript", function: "conversation", keys: 1 }] },
        }),
      );
    });
  });

  describe("when one conversation is larger than one value may be", () => {
    /** @scenario "A single value past the per-value ceiling is cut and reported" */
    it("cuts the value and reports APP_FUNCTION_VALUE_TRUNCATED", async () => {
      const result = await query({
        service: serviceOver({ keys: ["thread-a"], maxHydratedValueBytes: 8 }),
        sql: CONVERSATION_QUERY,
      });

      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "APP_FUNCTION_VALUE_TRUNCATED",
      );
    });
  });

  describe("when the statement judges", () => {
    it("leaves the eval column as the database answered it when nothing judges", async () => {
      const service = serviceOver({ keys: ["thread-a"] });

      const result = await service.executeForProjects({
        projects: [{ id: "project-1", lwqlKey: "key-1" }],
        protections: EVERYTHING_VISIBLE,
        sql:
          "SELECT TraceId, eval(conversation(ConversationId), 'The customer sounds annoyed') " +
          "AS transcript FROM analytics.trace_metrics",
        isInstantEvalsEnabled: true,
      });

      expect(result.rows).toEqual([{ TraceId: "trace-of-thread-a", transcript: "thread-a" }]);
    });
  });
});
