/**
 * What makes a statement acceptable as a run.
 *
 * @see ../statement.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import type {
  LangWatchQLAppFunctionCall,
  LangWatchQLColumn,
  LangWatchQLService,
} from "~/server/analytics/lwql";
import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_PAGE_PARAMETER,
} from "../composition";
import type { InstantEvalRowSource } from "../row-source";
import { acceptInstantEvalStatement } from "../statement";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const PROTECTIONS = {} as never;

const judged: LangWatchQLAppFunctionCall = {
  column: "annoyed",
  function: "eval",
  options: ["The customer sounds annoyed"],
  source: { function: "conversation_bounded", options: [8000, ""] },
};

const extraction: LangWatchQLAppFunctionCall = {
  column: "conversation",
  function: "conversation_bounded",
  options: [8000, ""],
};

function harness(options?: {
  appFunctions?: LangWatchQLAppFunctionCall[];
  parameters?: { name: string; type: string }[];
  columns?: LangWatchQLColumn[];
  validateThrows?: unknown;
}) {
  const query = {
    validate: vi.fn(() => {
      if (options?.validateThrows) throw options.validateThrows;
      return {
        ok: true,
        appFunctions: options?.appFunctions ?? [judged],
        parameters: options?.parameters ?? [],
        tables: [],
        followsTimeWindow: false,
        awaitingTimeWindow: [],
      };
    }),
  } as unknown as LangWatchQLService;

  const rowSource = {
    probe: vi.fn(
      async () =>
        options?.columns ?? [
          { name: "TraceId", type: "String" },
          { name: "ThreadId", type: "String" },
          { name: "annoyed", type: "Nullable(String)" },
        ],
    ),
    keys: vi.fn(),
    read: vi.fn(),
    judgePrepared: vi.fn(),
    judge: vi.fn(),
    texts: vi.fn(),
  } as unknown as InstantEvalRowSource;

  return { query, rowSource };
}

const accept = ({
  query,
  rowSource,
  sql = "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces",
  parameters,
}: {
  query: LangWatchQLService;
  rowSource: InstantEvalRowSource;
  sql?: string;
  parameters?: Record<string, unknown>;
}) =>
  acceptInstantEvalStatement({
    query,
    rowSource,
    caller: CALLER,
    protections: PROTECTIONS,
    sql,
    ...(parameters ? { parameters } : {}),
  });

describe("given a statement a run could execute", () => {
  describe("when it is accepted", () => {
    /** @scenario "A statement that projects a trace id and a judged column is accepted" */
    it("derives its questions and keeps its plan", async () => {
      const { query, rowSource } = harness();

      const accepted = await accept({ query, rowSource });

      expect(accepted.questions.map((question) => question.id)).toEqual([
        "annoyed",
      ]);
      expect(accepted.plan).toEqual([judged]);
    });

    it("reports the optional key columns it projects", async () => {
      const { query, rowSource } = harness();

      const accepted = await accept({ query, rowSource });

      expect(accepted.keyColumns).toEqual(["ThreadId"]);
    });

    /** @scenario "The missing-column check runs the statement for no rows at all" */
    it("probes it rather than reading rows", async () => {
      const { query, rowSource } = harness();

      await accept({ query, rowSource });

      expect(rowSource.judge).not.toHaveBeenCalled();
      expect(rowSource.read).not.toHaveBeenCalled();
      expect(rowSource.keys).not.toHaveBeenCalled();
    });
  });
});

describe("given a statement the query policy refuses", () => {
  describe("when it is accepted", () => {
    /** @scenario "A statement the query policy refuses is refused here with the same reason" */
    it("is refused as an invalid query, carrying the policy's violations", async () => {
      const refusal = new (class extends HandledError {})(
        "lwql_not_permitted",
        "The submitted SQL is not permitted by the LangWatchQL analytics policy.",
        {
          httpStatus: 400,
          fault: "customer",
          meta: { violations: [{ code: "TABLE_NOT_ALLOWED" }] },
        },
      );
      const { query, rowSource } = harness({ validateThrows: refusal });

      await expect(accept({ query, rowSource })).rejects.toMatchObject({
        code: "instant_eval_query_invalid",
        meta: { violations: [{ code: "TABLE_NOT_ALLOWED" }] },
      });
    });
  });
});

describe("given a statement a job cannot fill the parameters of", () => {
  describe("when it declares the dashboard's own period", () => {
    /** @scenario "A statement declaring the surface-owned parameters is refused" */
    it("is refused, naming the parameters", async () => {
      const { query, rowSource } = harness({
        parameters: [
          { name: "dashboard_context_period_start", type: "DateTime" },
          { name: "dashboard_context_period_end", type: "DateTime" },
        ],
      });

      await expect(accept({ query, rowSource })).rejects.toMatchObject({
        code: "instant_eval_query_invalid",
        meta: {
          parameters: [
            "dashboard_context_period_end",
            "dashboard_context_period_start",
          ],
        },
      });
    });
  });

  describe("when it declares a name the run binds itself", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("is refused, naming the parameter", async () => {
      const { query, rowSource } = harness({
        parameters: [
          { name: INSTANT_EVAL_PAGE_PARAMETER, type: "Array(String)" },
        ],
      });

      await expect(accept({ query, rowSource })).rejects.toMatchObject({
        code: "instant_eval_query_invalid",
        meta: { parameters: [INSTANT_EVAL_PAGE_PARAMETER] },
      });
    });
  });

  describe("when the request supplies a name the run binds itself", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("is refused before the policy is even asked", async () => {
      const { query, rowSource } = harness();

      await expect(
        accept({
          query,
          rowSource,
          parameters: { [INSTANT_EVAL_AFTER_PARAMETER]: "t1" },
        }),
      ).rejects.toMatchObject({ code: "instant_eval_query_invalid" });
      expect(query.validate).not.toHaveBeenCalled();
    });
  });
});

describe("given a statement missing what a run needs", () => {
  describe("when it projects no eval function", () => {
    /** @scenario "A statement with no eval function is refused" */
    it("is refused for having nothing to judge", async () => {
      const { query, rowSource } = harness({ appFunctions: [extraction] });

      await expect(accept({ query, rowSource })).rejects.toMatchObject({
        code: "instant_eval_query_missing_columns",
        meta: { needsEvalFunction: true },
      });
    });
  });

  describe("when it projects no trace id", () => {
    /** @scenario "A statement with no trace id is refused before anything runs" */
    it("is refused, naming the column", async () => {
      const { query, rowSource } = harness({
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
      });

      await expect(accept({ query, rowSource })).rejects.toMatchObject({
        code: "instant_eval_query_missing_columns",
        meta: { missing: ["TraceId"], needsEvalFunction: false },
      });
    });
  });
});
