import { checkTenantScope } from "@langwatch/clickhouse-client";
import { it } from "vitest";
import { traceQueryTranslation } from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";

it("probe", () => {
  const W = { from: Date.now() - 86400000, to: Date.now() };
  const evalRuns = [{ question: "is it twinned", target: "traces", runId: "r", writtenFrom: W.from, writtenUntil: W.to }] as never;
  for (const f of ["scenarioVerdict:success", "evaluator:nobody", 'eval:"is it twinned"']) {
    const w = traceQueryTranslation.translateFilter({ queryText: `NOT ${f}`, timeRange: W, evalRuns });
    console.log("FIELD", f, JSON.stringify(w));
  }
});
