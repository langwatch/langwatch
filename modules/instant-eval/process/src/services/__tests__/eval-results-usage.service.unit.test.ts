/**
 * The usage report's judge calls: kept rows a judge answered, counted only for organizations
 * with release_instant_eval_results on, and left out where none has it.
 * @see specs/self-hosting/connected-services/usage-report.feature
 */

import { describe, expect, it } from "vitest";

import { MemoryEvalResultsRepository } from "../../repositories/memory/memory.eval-results.repository.ts";
import { EVAL_RESULTS_KEY_VERSION } from "../../rules/eval-results-key.rules.ts";
import { EvalResultsUsageService } from "../eval-results-usage.service.ts";

const AT = Date.UTC(2026, 10, 2, 10);

async function storeWith(rows: readonly { tenantId: string; judgedAt: number }[]) {
  const results = MemoryEvalResultsRepository.create();
  await results.insert(
    rows.map(({ tenantId, judgedAt }, index) => ({
      TenantId: tenantId,
      TraceId: `trace-${index}`,
      SpanId: "",
      QuestionHash: "question",
      Question: "Is the customer annoyed?",
      Kind: "boolean",
      JudgeModel: "langwatch/instant-evals",
      InputHash: "input",
      JudgedColumn: "llm_readable_trace",
      KeyVersion: EVAL_RESULTS_KEY_VERSION,
      Source: "ask" as const,
      SourceId: "query:1",
      Status: "judged" as const,
      Score: null,
      Label: "",
      Probability: 0.9,
      Probabilities: "",
      Error: "",
      OccurredAt: judgedAt,
      JudgedAt: judgedAt,
      UpdatedAt: judgedAt,
      _retention_days: 0,
    })),
  );
  return results;
}

function usageOver({
  results,
  released,
}: {
  results: MemoryEvalResultsRepository;
  released: readonly string[];
}): EvalResultsUsageService {
  const organizationOf: Readonly<Record<string, string>> = {
    "project-on": "organization-on",
    "project-off": "organization-off",
  };
  return EvalResultsUsageService.create({
    results,
    peers: {
      findOrganizationId: async (projectId) => organizationOf[projectId],
      isReleasedForOrganization: async ({ organizationId }) => released.includes(organizationId),
    },
  });
}

describe("given judge calls in an organization with the flag and one without", () => {
  describe("when judge calls are counted", () => {
    it("counts only the released organization's projects, lifetime and since a window", async () => {
      const results = await storeWith([
        { tenantId: "project-on", judgedAt: AT },
        { tenantId: "project-on", judgedAt: AT - 10_000 },
        { tenantId: "project-off", judgedAt: AT },
      ]);
      const usage = usageOver({ results, released: ["organization-on"] });
      const projectIds = ["project-on", "project-off"];

      await expect(usage.countJudgeCalls({ projectIds })).resolves.toEqual({ judgeCalls: 2 });
      await expect(usage.countJudgeCalls({ projectIds, since: AT })).resolves.toEqual({
        judgeCalls: 1,
      });
    });
  });
});

describe("given no organization with the flag", () => {
  describe("when judge calls are counted", () => {
    it("leaves the figure out", async () => {
      const results = await storeWith([{ tenantId: "project-off", judgedAt: AT }]);
      const usage = usageOver({ results, released: [] });

      await expect(usage.countJudgeCalls({ projectIds: ["project-off"] })).resolves.toEqual({});
    });
  });
});
