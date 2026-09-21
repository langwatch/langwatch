/**
 * What makes a statement acceptable as a run.
 * @see specs/instant-evals/instant-eval-api.feature
 */

import type {
  LangWatchQLAcceptedStatement,
  LangWatchQLAppFunctionCall,
  LangWatchQLColumn,
  LangWatchQLExecuteInput,
  LangWatchQLJudgementCall,
  LangWatchQLQueryResult,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_PAGE_PARAMETER,
} from "../../rules/instant-eval-composition.rules.ts";
import {
  InstantEvalRowSourceService,
  type InstantEvalStatementRunner,
} from "../instant-eval-row-source.service.ts";
import {
  InstantEvalStatementService,
  type InstantEvalStatementValidator,
} from "../instant-eval-statement.service.ts";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const PROTECTIONS = {};
const SQL =
  "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM analytics.traces";

const judged: LangWatchQLAppFunctionCall = {
  column: "annoyed",
  function: "eval",
  options: ["The customer sounds annoyed"],
  source: { function: "conversation_bounded", options: [8_000, ""] },
};

const extraction: LangWatchQLAppFunctionCall = {
  column: "conversation",
  function: "conversation_bounded",
  options: [8_000, ""],
};

const PROJECTION: LangWatchQLColumn[] = [
  { name: "TraceId", type: "String" },
  { name: "ThreadId", type: "String" },
  { name: "annoyed", type: "Nullable(String)" },
];

/** An Analytics peer whose verdict on the statement the suite states. */
class ScriptedAnalytics implements InstantEvalStatementValidator {
  askedToValidate = 0;

  constructor(
    private readonly options: {
      appFunctions?: readonly LangWatchQLAppFunctionCall[];
      parameters?: readonly { name: string; type: string }[];
      validateThrows?: unknown;
    } = {},
  ) {}

  validateLangWatchQL(_input: LangWatchQLValidationInput): LangWatchQLAcceptedStatement {
    this.askedToValidate += 1;
    if (this.options.validateThrows) throw this.options.validateThrows;

    return {
      parameters: this.options.parameters ?? [],
      appFunctions: this.options.appFunctions ?? [judged],
    };
  }

  /** The catalogue's own derivation, narrowed to what these fixtures need. */
  describeLangWatchQLJudgements(input: {
    appFunctions: readonly LangWatchQLAppFunctionCall[];
  }): readonly LangWatchQLJudgementCall[] {
    return input.appFunctions
      .filter((call) => call.function.startsWith("eval"))
      .map((call) => ({
        column: call.column,
        function: call.function,
        reads: "probability" as const,
        kind: "boolean" as const,
        instructions: "The customer sounds annoyed",
      }));
  }
}

/** A row source whose probe answers the projection the suite states. */
class ProbeOnlyRunner implements InstantEvalStatementRunner {
  readonly asked: LangWatchQLExecuteInput[] = [];

  constructor(private readonly columns: readonly LangWatchQLColumn[]) {}

  async executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    this.asked.push(input);

    return {
      columns: this.columns,
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
      truncated: false,
      diagnostics: [],
      followsTimeWindow: true,
      followsGranularity: true,
    };
  }
}

function harness(options?: {
  appFunctions?: readonly LangWatchQLAppFunctionCall[];
  parameters?: readonly { name: string; type: string }[];
  columns?: readonly LangWatchQLColumn[];
  validateThrows?: unknown;
}) {
  const analytics = new ScriptedAnalytics({
    ...(options?.appFunctions ? { appFunctions: options.appFunctions } : {}),
    ...(options?.parameters ? { parameters: options.parameters } : {}),
    ...(options?.validateThrows ? { validateThrows: options.validateThrows } : {}),
  });
  const runner = new ProbeOnlyRunner(options?.columns ?? PROJECTION);
  const statements = InstantEvalStatementService.create({
    analytics,
    rowSource: InstantEvalRowSourceService.create({ analytics: runner }),
  });

  return { analytics, runner, statements };
}

const accept = (statements: InstantEvalStatementService, parameters?: Record<string, unknown>) =>
  statements.accept({
    caller: CALLER,
    protections: PROTECTIONS,
    sql: SQL,
    ...(parameters ? { parameters } : {}),
  });

describe("given a statement a run could execute", () => {
  describe("when it is accepted", () => {
    /** @scenario "A statement that projects a trace id and a judged column is accepted" */
    it("derives its questions and keeps its plan", async () => {
      const { statements } = harness();

      const accepted = await accept(statements);

      expect(accepted.questions.map((question) => question.id)).toEqual(["annoyed"]);
      expect(accepted.plan).toEqual([judged]);
    });

    it("reports the optional key columns it projects", async () => {
      const { statements } = harness();

      expect((await accept(statements)).keyColumns).toEqual(["ThreadId"]);
    });

    /** @scenario "The missing-column check runs the statement for no rows at all" */
    it("probes it rather than reading rows", async () => {
      const { statements, runner } = harness();

      await accept(statements);

      expect(runner.asked).toHaveLength(1);
      expect(runner.asked[0]?.sql).toContain("LIMIT 0");
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
      const { statements } = harness({ validateThrows: refusal });

      await expect(accept(statements)).rejects.toMatchObject({
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
      const { statements } = harness({
        parameters: [
          { name: "dashboard_context_period_start", type: "DateTime" },
          { name: "dashboard_context_period_end", type: "DateTime" },
        ],
      });

      await expect(accept(statements)).rejects.toMatchObject({
        code: "instant_eval_query_invalid",
        meta: {
          parameters: ["dashboard_context_period_end", "dashboard_context_period_start"],
        },
      });
    });
  });

  describe("when it declares a name the run binds itself", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("is refused, naming the parameter", async () => {
      const { statements } = harness({
        parameters: [{ name: INSTANT_EVAL_PAGE_PARAMETER, type: "Array(String)" }],
      });

      await expect(accept(statements)).rejects.toMatchObject({
        code: "instant_eval_query_invalid",
        meta: { parameters: [INSTANT_EVAL_PAGE_PARAMETER] },
      });
    });
  });

  describe("when the request supplies a name the run binds itself", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("is refused before the policy is even asked", async () => {
      const { statements, analytics } = harness();

      await expect(
        accept(statements, { [INSTANT_EVAL_AFTER_PARAMETER]: "t1" }),
      ).rejects.toMatchObject({ code: "instant_eval_query_invalid" });
      expect(analytics.askedToValidate).toBe(0);
    });
  });
});

describe("given a statement missing what a run needs", () => {
  describe("when it projects no eval function", () => {
    /** @scenario "A statement with no eval function is refused" */
    it("is refused for having nothing to judge", async () => {
      const { statements } = harness({ appFunctions: [extraction] });

      await expect(accept(statements)).rejects.toMatchObject({
        code: "instant_eval_query_missing_columns",
        meta: { isEvalFunctionMissing: true },
      });
    });
  });

  describe("when it projects no trace id", () => {
    /** @scenario "A statement with no trace id is refused before anything runs" */
    it("is refused, naming the column", async () => {
      const { statements } = harness({
        columns: [{ name: "annoyed", type: "Nullable(String)" }],
      });

      await expect(accept(statements)).rejects.toMatchObject({
        code: "instant_eval_query_missing_columns",
        meta: { missing: ["TraceId"], isEvalFunctionMissing: false },
      });
    });
  });
});
