/**
 * A run is judged where it will run: the statement is validated by the query layer for a run,
 * which asks the organization's route, and a refusal of the route is not rewritten as a refusal
 * of the statement.
 * @see modules/instant-eval/specs/instant-eval-api.feature
 */

import type {
  LangWatchQLAcceptedStatement,
  LangWatchQLAppFunctionCall,
  LangWatchQLColumn,
  LangWatchQLJudgementCall,
  LangWatchQLPassInput,
  LangWatchQLQueryResult,
  LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  InstantEvalRowSourceService,
  type InstantEvalStatementRunner,
} from "../instant-eval-row-source.service.ts";
import { InstantEvalStatementService } from "../instant-eval-statement.service.ts";

const CALLER = { id: "project-1", lwqlKey: "lwql-secret" };
const PROTECTIONS = { catalogue: { permissions: [] } };
const SQL =
  "SELECT TraceId, eval(conversation(ConversationId), 'x') AS annoyed FROM acme_db.traces";
const judged: LangWatchQLAppFunctionCall = {
  column: "annoyed",
  function: "eval",
  options: ["The customer sounds annoyed"],
  source: { function: "conversation_bounded", options: [8_000, ""] },
};
const PROJECTION: LangWatchQLColumn[] = [
  { name: "TraceId", type: "String" },
  { name: "annoyed", type: "Nullable(String)" },
];

class Refusal extends HandledError {
  constructor(code: string) {
    super(code, "refused", {
      httpStatus: 400,
      fault: "customer",
      meta: { violations: [{ code: "TABLE_NOT_ALLOWED" }] },
    });
  }
}

/** Answers the run-time validation as the suite states. */
class RouteAwareAnalytics {
  constructor(private readonly runVerdict: Error | undefined) {}

  validateLangWatchQLForRun(
    _input: LangWatchQLValidationInput,
  ): Promise<LangWatchQLAcceptedStatement> {
    return this.runVerdict
      ? Promise.reject(this.runVerdict)
      : Promise.resolve({ parameters: [], appFunctions: [judged] });
  }

  describeLangWatchQLJudgements(input: {
    appFunctions: readonly LangWatchQLAppFunctionCall[];
  }): readonly LangWatchQLJudgementCall[] {
    return input.appFunctions.map((call) => ({
      column: call.column,
      function: call.function,
      reads: "probability" as const,
      kind: "boolean" as const,
      instructions: "The customer sounds annoyed",
    }));
  }
}

class ProbeOnlyRunner implements InstantEvalStatementRunner {
  async executeLangWatchQLPass(_input: LangWatchQLPassInput): Promise<LangWatchQLQueryResult> {
    return {
      columns: PROJECTION,
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
      diagnostics: [],
      followsTimeWindow: true,
      followsGranularity: true,
    };
  }
}

const accept = (runVerdict?: Error) => {
  const statements = InstantEvalStatementService.create({
    analytics: new RouteAwareAnalytics(runVerdict) as never,
    rowSource: InstantEvalRowSourceService.create({
      analytics: new ProbeOnlyRunner(),
      access: { isEnabled: () => Promise.resolve(true) },
    }),
  });

  return statements.accept({ caller: CALLER, protections: PROTECTIONS, sql: SQL });
};

describe("given a run validated at its start", () => {
  /** @scenario "A run is judged against the organization's route, and a route refusal is not rewritten" */
  it("passes a route refusal through by its error code, not its class, because the two refusal codes belong to classes of different packages", async () => {
    const routeRefusal = new Refusal("private_dataplane_unavailable");

    await expect(accept(routeRefusal)).rejects.toBe(routeRefusal);
  });

  /** @scenario "A run is judged against the organization's route, and a route refusal is not rewritten" */
  it("still refuses a statement the policy refuses as an invalid query", async () => {
    await expect(accept(new Refusal("lwql_not_permitted"))).rejects.toMatchObject({
      code: "instant_eval_query_invalid",
      meta: { violations: [{ code: "TABLE_NOT_ALLOWED" }] },
    });
  });

  /** @scenario "A run is judged against the organization's route, and a route refusal is not rewritten" */
  it("accepts a statement the run-time validation admits", async () => {
    await expect(accept()).resolves.toMatchObject({ sql: SQL });
  });
});
