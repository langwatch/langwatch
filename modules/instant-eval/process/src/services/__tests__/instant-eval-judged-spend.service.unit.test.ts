/**
 * A run's and a judged query's spend, recorded through the Instant Evals judge under the
 * organization this module resolves (ADR-174 decision 13). The judge stands in as a fixture
 * that answers only `recordSpend`, so any other call on it fails the test.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */
import type { LangWatchQLJudgementCall } from "@langwatch/analytics-contract";
import {
  INSTANT_EVAL_PRICING,
  type InstantEvalJudgeApi,
  type InstantEvalJudgeSpendRecord,
} from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { DeterministicInstantEvalJudgeChannel } from "../../channels/memory/memory.instant-eval-judging.channel.ts";
import { InstantEvalFinishService } from "../instant-eval-finish.service.ts";
import { InstantEvalJudgeRowsService } from "../instant-eval-judge-rows.service.ts";
import { InstantEvalJudgedSpendService } from "../instant-eval-judged-spend.service.ts";
import { InstantEvalQueryJudgingService } from "../instant-eval-query-judging.service.ts";

const PROJECT_ID = "project-unknown-to-the-judge";
const ORGANIZATION_ID = "organization-resolved-here";
const RUN_ID = "run-1";
const AT = Temporal.Instant.from("2026-10-07T10:00:00Z");

const JUDGEMENT = {
  column: "polite",
  function: "eval_bool",
  reads: "probability",
  kind: "boolean",
  instructions: "Is it polite?",
} as LangWatchQLJudgementCall;

/** The judge as a fixture answering only `recordSpend`, and what it was told. */
function judging({ fails = false }: { fails?: boolean } = {}) {
  const recorded: InstantEvalJudgeSpendRecord[] = [];
  const lookedUp: string[] = [];
  const judges = createApiFixture<InstantEvalJudgeApi>({
    recordSpend: async (record) => {
      if (fails) throw new Error("the judge could not store the priced fact");
      recorded.push(record);
    },
  });
  const spend = InstantEvalJudgedSpendService.create({
    peers: {
      findOrganizationId: async ({ projectId }) => {
        lookedUp.push(projectId);
        return ORGANIZATION_ID;
      },
      judges,
    },
  });
  return { spend, recorded, lookedUp };
}

function finishOver(spend: InstantEvalJudgedSpendService): InstantEvalFinishService {
  return InstantEvalFinishService.create({
    spend,
    budget: { release: async () => undefined },
    pricing: INSTANT_EVAL_PRICING,
    now: () => AT,
  });
}

const finishRun = (spend: InstantEvalJudgedSpendService, outcome: "finished" | "cancelled") =>
  finishOver(spend).finish({
    runId: RUN_ID,
    projectId: PROJECT_ID,
    outcome,
    inputTokens: 2_000,
    requests: 40,
  });

async function judgeQuery(spend: InstantEvalJudgedSpendService): Promise<void> {
  const queries = InstantEvalQueryJudgingService.create({
    rows: InstantEvalJudgeRowsService.create({
      judge: DeterministicInstantEvalJudgeChannel.create(),
    }),
    budget: { reserve: async () => undefined, release: async () => undefined },
    spend,
    pricing: INSTANT_EVAL_PRICING,
    queryTokenBudget: 4_000_000,
    now: () => AT,
  });
  await queries.judgeQuery({
    projectId: PROJECT_ID,
    judgements: [JUDGEMENT],
    rows: [{ polite: "thank you" }, { polite: "go away" }],
  });
}

describe("given a project the Instant Evals judge has not learned, in an organization Instant Evals resolves", () => {
  /** @scenario "Runs and judged queries record spend under the organization Instant Evals resolves" */
  it.each([
    { work: "run", record: (spend: InstantEvalJudgedSpendService) => finishRun(spend, "finished") },
    { work: "judged query", record: judgeQuery },
  ])(
    "records a $work's spend under that organization, asking the judge for nothing else",
    async ({ record }) => {
      const { spend, recorded, lookedUp } = judging();

      await record(spend);

      expect(lookedUp).toEqual([PROJECT_ID]);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        occurredAt: AT.epochMilliseconds,
      });
      expect(recorded[0]?.inputTokens).toBeGreaterThan(0);
    },
  );
});

describe("given a run that judged two thousand input tokens over forty rows", () => {
  describe("when it finishes", () => {
    /** @scenario "A finished run is one confirmed spend record addressed by the run" */
    it("sends one record through the judge, under the run's own id, with its tokens and requests", async () => {
      const { spend, recorded } = judging();

      await finishRun(spend, "finished");

      expect(recorded).toEqual([
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          requestId: `instanteval_${RUN_ID}`,
          inputTokens: 2_000,
          requests: 40,
          runId: RUN_ID,
          occurredAt: AT.epochMilliseconds,
        },
      ]);
    });
  });

  describe("when its finish is retried under another finish reason, on another pod", () => {
    /** @scenario "A retried run records its spend under the same request" */
    /** @scenario "A retried finish records the same request rather than a second one" */
    it("records again under the same request id as the first attempt", async () => {
      const firstPod = judging();
      const secondPod = judging();

      await finishRun(firstPod.spend, "finished");
      await finishRun(secondPod.spend, "cancelled");

      expect(firstPod.recorded[0]?.requestId).toBe(`instanteval_${RUN_ID}`);
      expect(secondPod.recorded[0]?.requestId).toBe(firstPod.recorded[0]?.requestId);
    });
  });

  describe("when the judge cannot store its spend", () => {
    /** @scenario "A record that cannot be dispatched is raised, not dropped" */
    it("raises the failure, so the finish is delivered again", async () => {
      const { spend } = judging({ fails: true });

      await expect(finishRun(spend, "finished")).rejects.toThrow(/could not store/);
    });
  });
});

describe("given a project with no organization", () => {
  it("records nothing and asks the judge for nothing, since there is no one to bill", async () => {
    const recorded: InstantEvalJudgeSpendRecord[] = [];
    const spend = InstantEvalJudgedSpendService.create({
      peers: {
        findOrganizationId: async () => undefined,
        judges: createApiFixture<InstantEvalJudgeApi>({
          recordSpend: async (record) => {
            recorded.push(record);
          },
        }),
      },
    });

    await finishRun(spend, "finished");

    expect(recorded).toEqual([]);
  });
});
