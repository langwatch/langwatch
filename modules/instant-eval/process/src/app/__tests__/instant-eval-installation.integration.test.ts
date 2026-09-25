/**
 * Instant Evals installed the way a process installs it, over the memory tier
 * and real peer resolution: no ClickHouse, no queue, no HTTP.
 * @vitest-environment node
 * @see specs/instant-evals/instant-eval-api.feature
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */
import type {
  AnalyticsApi,
  LangWatchQLJudgementCall,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  InstantEvalApi,
  type InstantEvalActor,
  type InstantEvalRunInput,
} from "@langwatch/instant-eval-contract";
import { createApp, type ModuleSecretsScope, withMemoryRepositories } from "@langwatch/kernel";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import type { InstantEvalJudgeChannel } from "../../channels/instant-eval-judge.channel.ts";
import { MemoryInstantEvalJudgeChannel } from "../../channels/memory/memory.instant-eval-judge.channel.ts";
import { instantEvalServer } from "../../instant-eval.server.ts";

const PROJECT = "project-1";
const ORGANIZATION = "organization-1";
const ACTOR: InstantEvalActor = { kind: "member", userId: "user-1" };
const STATEMENT = "SELECT TraceId, eval_bool(Output, 'is it polite?') AS polite FROM traces";

const JUDGEMENT: LangWatchQLJudgementCall = {
  column: "polite",
  function: "eval_bool",
  reads: "probability",
  kind: "boolean",
  instructions: "is it polite?",
};

function execution(rows: readonly Readonly<Record<string, unknown>>[]): LangWatchQLQueryResult {
  return {
    columns: [
      { name: "TraceId", type: "String" },
      { name: "polite", type: "Float64" },
    ],
    rows,
    statistics: { elapsedMs: 1, rowsRead: rows.length, bytesRead: 0, rowsReturned: rows.length },
    diagnostics: [],
    followsTimeWindow: true,
    followsGranularity: true,
  };
}

function planFor({ free }: { free: boolean }): Plan {
  return {
    planSource: free ? "free" : "subscription",
    type: free ? "FREE" : "PRO",
    name: free ? "Free" : "Pro",
    free,
    maxMembers: free ? 1 : 10,
    maxMembersLite: 0,
    maxMessagesPerMonth: free ? 1_000 : 100_000,
    canPublish: !free,
    prices: { USD: free ? 0 : 199, EUR: free ? 0 : 199 },
  };
}

/** The judge credential, from a chain over a fake environment, scoped as boot scopes it. */
function judgeSecrets(judgeKey: string | undefined): ModuleSecretsScope {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { JEV_API_KEY: judgeKey } }).withEnv(),
  );
  return (owner, declared) => resolver.scopeTo(owner, declared);
}

const instantEval = withMemoryRepositories(instantEvalServer);

/** A connect judge that records which organizations it was asked about. */
function connectJudgeAskedAbout(asked: string[]): InstantEvalJudgeChannel {
  const memory = MemoryInstantEvalJudgeChannel.create();
  return {
    limits: memory.limits,
    pricing: memory.pricing,
    classify: () => memory.classify(),
    isAvailableForOrganization: async (organizationId) => {
      asked.push(organizationId);
      return true;
    },
  };
}

/** The peers a run resolves through, each answering the one question it asks. */
function installation({
  isReleased = true,
  isFreePlan = true,
  classifier = "jev",
  judgeKey = "test-judge-key",
  connectJudge = null,
  isBounded = false,
}: {
  isReleased?: boolean;
  isFreePlan?: boolean;
  classifier?: "jev" | "null" | undefined;
  /** `null` is an install that configured no key of its own. */
  judgeKey?: string | null;
  connectJudge?: InstantEvalJudgeChannel | null;
  isBounded?: boolean;
} = {}) {
  return (
    createApp({ role: "api", secrets: judgeSecrets(judgeKey ?? undefined) })
      .withModules([instantEval])
      .withConfig({
        "instant-eval": {
          classifier,
          classifierBaseUrl: undefined,
          classifierModel: undefined,
          globalTokensPerSecond: 300_000,
          tenantTokensPerSecond: 150_000,
          isBounded,
          queryTokenBudget: 4_000_000,
        },
      })
      .withStores(memoryStores())
      // The api role sends commands; what drains them is the worker's, and the
      // pipeline has its own tests.
      .withEventing(
        new EventSourcing({
          enabled: false,
          processStore: InMemoryProcessStore.createForTesting(),
        }),
      )
      // The shared bucket, the holds and the cancel hints each have a twin.
      .withKeyvalue(null)
      .withMembers({ connectJudge })
      .provide({
        analytics: createApiFixture<AnalyticsApi>({
          isLangWatchQLAvailable: () => true,
          langWatchQLDatabase: () => "analytics",
          resolveApiKeyRunCaller: async () => ({ id: PROJECT, lwqlKey: "key" }),
          resolveApiKeyProtections: async () => ({}),
          resolveRunCaller: async () => ({
            project: { id: PROJECT, lwqlKey: "key" },
            protections: {},
          }),
          validateLangWatchQL: () => ({ parameters: [], appFunctions: [] }),
          describeLangWatchQLJudgements: () => [JUDGEMENT],
          executeLangWatchQL: async () => execution([]),
        }),
        project: createApiFixture<ProjectApi>({
          findOrganizationId: async () => ORGANIZATION,
          getOrganizationId: async () => ORGANIZATION,
          listIdsByOrganization: async () => [PROJECT],
        }),
        entitlement: createApiFixture<EntitlementApi>({
          getActivePlan: async () => planFor({ free: isFreePlan }),
        }),
        gateway: createApiFixture<GatewayApi>({}),
        trace: createApiFixture<TraceApi>({}),
        "feature-flag": createApiFixture<FeatureFlagApi>({
          isEnabled: async () => isReleased,
        }),
      })
  );
}

async function withInstallation<T>(
  options: Parameters<typeof installation>[0],
  read: (api: InstantEvalApi) => Promise<T>,
): Promise<T> {
  const runtime = await installation(options).boot();

  try {
    return await read(runtime.service(InstantEvalApi));
  } finally {
    await runtime.stop();
  }
}

function runOf(overrides: Partial<InstantEvalRunInput> = {}): InstantEvalRunInput {
  return { sql: STATEMENT, ...overrides };
}

/** The refusal a read answered with, as the caller reads it: code, then meta. */
async function refusalOf(
  read: Promise<unknown>,
): Promise<{ code: string; meta: Record<string, unknown> }> {
  try {
    await read;
  } catch (error) {
    if (error instanceof HandledError) return { code: error.code, meta: error.meta };
    throw error;
  }

  throw new Error("The read was answered where a refusal was expected.");
}

async function codeOf(read: Promise<unknown>): Promise<string> {
  return (await refusalOf(read)).code;
}

describe("given a process that installs Instant Evals over the memory tier", () => {
  describe("when a project's flag is off", () => {
    /** @scenario "A project without the flag cannot reach the family" */
    it("refuses a run by name rather than reading anything on the caller's behalf", async () => {
      await withInstallation({ isReleased: false }, async (api) => {
        await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(false);
        await expect(
          codeOf(api.createRun({ projectId: PROJECT, actor: ACTOR, input: runOf() })),
        ).resolves.toBe("instant_eval_not_enabled");
      });
    });
  });

  describe("when a free plan asks for more rows than its cap", () => {
    /** @scenario "A free plan asking past the default cap is refused and told what lifts it" */
    it("refuses with the cap and the plan it was capped by", async () => {
      await withInstallation({ isFreePlan: true }, async (api) => {
        const refusal = await refusalOf(
          api.createRun({ projectId: PROJECT, actor: ACTOR, input: runOf({ limit: 50_000 }) }),
        );

        expect(refusal.code).toBe("instant_eval_row_cap_exceeded");
        expect(refusal.meta).toMatchObject({ requested: 50_000, cap: 10_000 });
      });
    });
  });

  describe("when a paid plan asks for the same rows", () => {
    /** @scenario "A paid plan may ask up to the raised cap" */
    it("accepts the run at the limit that was asked for", async () => {
      await withInstallation({ isFreePlan: false }, async (api) => {
        const run = await api.createRun({
          projectId: PROJECT,
          actor: ACTOR,
          input: runOf({ limit: 50_000 }),
        });

        expect(run).toMatchObject({ limit: 50_000, status: "queued", sql: STATEMENT });
      });
    });
  });

  describe("when a project has runs and another project has its own", () => {
    /** @scenario "Runs are listed newest first and scoped to the credential's project" */
    it("lists only this project's runs, newest first", async () => {
      await withInstallation({}, async (api) => {
        const first = await api.createRun({ projectId: PROJECT, actor: ACTOR, input: runOf() });
        const second = await api.createRun({ projectId: PROJECT, actor: ACTOR, input: runOf() });
        await api.createRun({ projectId: "project-2", actor: ACTOR, input: runOf() });

        const listed = await api.findRuns({ projectId: PROJECT, limit: 10 });

        expect(listed.map((run) => run.id)).toEqual([second.id, first.id]);
      });
    });
  });

  describe("when a request names both a statement and a target", () => {
    /** @scenario "A request carrying both a statement and a target is refused" */
    it("refuses as an invalid query rather than choosing one", async () => {
      await withInstallation({}, async (api) => {
        await expect(
          codeOf(
            api.createRun({
              projectId: PROJECT,
              actor: ACTOR,
              input: {
                sql: STATEMENT,
                shorthand: {
                  target: "traces",
                  questions: [{ kind: "boolean", instructions: "is it polite?" }],
                },
              },
            }),
          ),
        ).resolves.toBe("instant_eval_query_invalid");
      });
    });
  });

  describe("when a request names neither a statement nor a target", () => {
    /** @scenario "A request carrying neither a statement nor a target is refused" */
    it("refuses as an invalid query, naming what a run needs", async () => {
      await withInstallation({}, async (api) => {
        await expect(
          codeOf(api.createRun({ projectId: PROJECT, actor: ACTOR, input: {} })),
        ).resolves.toBe("instant_eval_query_invalid");
      });
    });
  });

  describe("when a request names a target and no statement", () => {
    /** @scenario "A request carrying a target and no statement is expanded" */
    it("judges the statement the expansion wrote, with the questions it asked", async () => {
      await withInstallation({}, async (api) => {
        const run = await api.createRun({
          projectId: PROJECT,
          actor: ACTOR,
          input: {
            shorthand: {
              target: "traces",
              questions: [{ kind: "boolean", instructions: "is it polite?" }],
            },
          },
        });

        expect(run.sql).toContain("traces");
        expect(run.questions.map((question) => question.id)).toEqual(["polite"]);
      });
    });
  });
});

describe("given a deployment choosing which judge answers", () => {
  describe("when the install sets no judge key and a connect judge is composed", () => {
    /** @scenario "An install that sets nothing new keeps the classifier it had" */
    it("judges through the connect judge, which answers per organization", async () => {
      const asked: string[] = [];
      await withInstallation(
        { classifier: undefined, judgeKey: null, connectJudge: connectJudgeAskedAbout(asked) },
        async (api) => {
          await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(true);
        },
      );

      expect(asked).toEqual([ORGANIZATION]);
    });
  });

  describe("when the install has its own judge key as well", () => {
    /** @scenario "An install with its own judge key keeps using it" */
    it("judges with that key and never asks the connect judge", async () => {
      const asked: string[] = [];
      await withInstallation(
        { classifier: undefined, connectJudge: connectJudgeAskedAbout(asked) },
        async (api) => {
          await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(true);
        },
      );

      expect(asked).toEqual([]);
    });
  });

  describe("when the install asked for no classifier at all", () => {
    it("takes that over both a judge key and the connect judge", async () => {
      await withInstallation(
        { classifier: "null", connectJudge: connectJudgeAskedAbout([]) },
        async (api) => {
          await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(false);
        },
      );
    });
  });

  describe("when there is neither a key nor a connect judge", () => {
    it("publishes the eval functions as unavailable", async () => {
      await withInstallation({ classifier: undefined, judgeKey: null }, async (api) => {
        await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(false);
      });
    });
  });
});

describe("given a deployment that bounds the free budget", () => {
  describe("when the process has no Redis for the budget holds", () => {
    it("refuses to install rather than keeping the holds to itself", async () => {
      await expect(installation({ isBounded: true }).boot()).rejects.toThrow(
        /needs a Redis connection for the budget holds/,
      );
    });
  });
});
