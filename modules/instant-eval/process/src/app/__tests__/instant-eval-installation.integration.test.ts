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
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi, GatewayPricedSpend } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  InstantEvalApi,
  type InstantEvalActor,
  InstantEvalMemoryJudgeInProductionError,
  type InstantEvalRunInput,
} from "@langwatch/instant-eval-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp, type ModuleSecretsScope } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import {
  type ProjectApi,
  type ProjectWithTeam,
  projectWithTeamSchema,
} from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { instantEvalProcessModule } from "../../instant-eval.module.ts";

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

const CREATED = new Date("2026-01-01T00:00:00.000Z");

/** The project a spend is attributed through: its team, and that team's organization. */
function projectWithTeam(id: string): ProjectWithTeam {
  return projectWithTeamSchema.parse({
    id,
    name: "Project",
    slug: "project",
    apiKey: "api-key",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "typescript",
    framework: "none",
    kind: "application",
    firstMessage: false,
    integrated: true,
    createdAt: CREATED,
    updatedAt: CREATED,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      id: "team-1",
      name: "Team",
      slug: "team",
      organizationId: ORGANIZATION,
      createdAt: CREATED,
      updatedAt: CREATED,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      departmentId: null,
    },
  });
}

/** The peers a run resolves through, each answering the one question it asks. */
function installation({
  isReleased = true,
  isOptedIn = false,
  isFreePlan = true,
  classifier = "jev",
  judgeKey = "test-judge-key",
  isBounded = false,
  gateway = {},
  isConnectOn = false,
  nodeEnvironment = "test",
  analytics = {},
  isSaas = true,
  planType,
  mayManageOrganization = true,
  recordOptIn = async () => undefined,
}: {
  isReleased?: boolean;
  /** Whether the organization switched Instant Evals on itself, as organization answers. */
  isOptedIn?: boolean;
  isFreePlan?: boolean;
  classifier?: "jev" | "null" | "memory" | undefined;
  /** `null` is an install that configured no key of its own. */
  judgeKey?: string | null;
  isBounded?: boolean;
  /** The gateway operations a hosted call's spend reaches. */
  gateway?: Partial<GatewayApi>;
  /** Whether the organization switched hosted judging on, as licensing answers. */
  isConnectOn?: boolean;
  nodeEnvironment?: string;
  /** Analytics operations a test answers itself, over the defaults below. */
  analytics?: Partial<AnalyticsApi>;
  isSaas?: boolean;
  /** The active plan's tier, which decides whether the switch is offered at all. */
  planType?: string;
  /** What authz answers for `organization:manage` on the project's organization. */
  mayManageOrganization?: boolean;
  recordOptIn?: OrganizationApi["recordInstantEvalsOptIn"];
} = {}) {
  return (
    createApp({ role: "api", secrets: judgeSecrets(judgeKey ?? undefined) })
      .withModules([instantEvalProcessModule])
      .withConfig({
        "instant-eval": {
          classifier,
          classifierBaseUrl: undefined,
          classifierModel: undefined,
          globalTokensPerSecond: 300_000,
          tenantTokensPerSecond: 150_000,
          isBounded,
          queryTokenBudget: 4_000_000,
          isSaas,
          nodeEnvironment,
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
      .provide({
        analytics: createApiFixture<AnalyticsApi>({
          isLangWatchQLAvailable: () => true,
          langWatchQLDatabase: () => "analytics",
          resolveApiKeyRunCaller: async () => ({ id: PROJECT, lwqlKey: "key" }),
          resolveApiKeyProtections: async () => ({ catalogue: { permissions: [] } }),
          resolveRunCaller: async () => ({
            project: { id: PROJECT, lwqlKey: "key" },
            protections: { catalogue: { permissions: [] } },
          }),
          validateLangWatchQL: () => ({ parameters: [], appFunctions: [] }),
          describeLangWatchQLJudgements: () => [JUDGEMENT],
          executeLangWatchQLPass: async () => execution([]),
          ...analytics,
        }),
        project: createApiFixture<ProjectApi>({
          findOrganizationId: async () => ORGANIZATION,
          getOrganizationId: async () => ORGANIZATION,
          listIdsByOrganization: async () => [PROJECT],
          findWithTeam: async (id) => projectWithTeam(id),
        }),
        entitlement: createApiFixture<EntitlementApi>({
          getActivePlan: async () => ({
            ...planFor({ free: isFreePlan }),
            ...(planType ? { type: planType } : {}),
          }),
        }),
        gateway: createApiFixture<GatewayApi>(gateway),
        licensing: createApiFixture<LicensingApi>({
          isConnectServiceEnabled: async () => isConnectOn,
        }),
        trace: createApiFixture<TraceApi>({}),
        organization: createApiFixture<OrganizationApi>({
          isInstantEvalsOptedIn: async () => isOptedIn,
          recordInstantEvalsOptIn: recordOptIn,
        }),
        authz: createApiFixture<AuthzApi>({ can: async () => mayManageOrganization }),
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

  describe("when a project's flag is off and its organization switched Instant Evals on", () => {
    /** @scenario "An organization that switched itself on is judged without the flag" */
    it("may judge, from the organization's switch", async () => {
      await withInstallation({ isReleased: false, isOptedIn: true }, async (api) => {
        await expect(api.isReleased({ projectId: PROJECT })).resolves.toBe(true);
        await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(true);
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

    /** @scenario "The run hands the expanded statement back" */
    it("reads back the expanded statement and the window it bound", async () => {
      await withInstallation({}, async (api) => {
        const created = await api.createRun({
          projectId: PROJECT,
          actor: ACTOR,
          input: {
            shorthand: {
              target: "traces",
              questions: [{ kind: "boolean", instructions: "is it polite?" }],
            },
          },
        });

        const read = await api.getRun({ projectId: PROJECT, runId: created.id });

        expect(read.sql).toBe(created.sql);
        expect(read.sql).toContain("{start_at:DateTime64(3, 'UTC')}");
        expect(Object.keys(read.parameters)).toEqual(
          expect.arrayContaining(["start_at", "end_at"]),
        );
      });
    });

    /** @scenario "An expanded statement passes the statement gate unchanged" */
    it("hands the gate each target's statement with every parameter it declares bound", async () => {
      const gated: { sql: string; parameters: Record<string, unknown> }[] = [];
      const analytics: Partial<AnalyticsApi> = {
        validateLangWatchQL: ({ sql, parameters = {} }) => {
          const declared = [...sql.matchAll(/\{(\w+):/g)].map((match) => match[1] ?? "");
          const unbound = declared.filter((name) => !(name in parameters));
          if (unbound.length > 0) throw new Error(`unbound parameters: ${unbound.join(", ")}`);
          gated.push({ sql, parameters });

          return {
            parameters: declared.map((name) => ({ name, type: "String" })),
            appFunctions: [],
          };
        },
      };

      await withInstallation({ analytics }, async (api) => {
        for (const target of ["traces", "threads", "llm_spans"] as const) {
          const run = await api.createRun({
            projectId: PROJECT,
            actor: ACTOR,
            input: {
              shorthand: {
                target,
                questions: [{ kind: "boolean", instructions: "is it polite?" }],
              },
            },
          });

          expect(gated.at(-1)?.sql).toBe(run.sql);
        }
      });

      expect(gated).toHaveLength(3);
      expect(gated.every((call) => "start_at" in call.parameters)).toBe(true);
    });
  });
});

describe("given a deployment choosing which judge answers", () => {
  describe("when there is no judge key", () => {
    it("publishes the eval functions as unavailable", async () => {
      await withInstallation({ classifier: undefined, judgeKey: null }, async (api) => {
        await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(false);
      });
    });

    it("publishes them once the organization switches hosted judging on", async () => {
      await withInstallation(
        { classifier: undefined, judgeKey: null, isConnectOn: true },
        async (api) => {
          await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(true);
        },
      );
    });
  });

  describe("when the operator names the memory classifier", () => {
    /** @scenario "A deployment that names the memory classifier judges with the deterministic stand-in" */
    it("publishes the eval functions with no key and no hosted judging", async () => {
      await withInstallation({ classifier: "memory", judgeKey: null }, async (api) => {
        await expect(api.isEnabled({ projectId: PROJECT })).resolves.toBe(true);
      });
    });

    /** @scenario "A production process refuses to boot on the memory judge" */
    it("refuses to boot in production", async () => {
      await expect(
        installation({ classifier: "memory", nodeEnvironment: "production" }).boot(),
      ).rejects.toThrow(InstantEvalMemoryJudgeInProductionError);
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

const HOSTED_SPEND = {
  projectId: PROJECT,
  virtualKeyId: "vk-connect",
  inputTokens: 2_000_000,
  requests: 3,
  costUsd: 2,
  priceUsd: 4,
  occurredAt: Temporal.Instant.from("2026-09-29T10:00:00Z"),
};

describe("given a hosted Connect call judged on LangWatch Cloud", () => {
  describe("when the spend spine is registered", () => {
    /** @scenario "Hosted spend is billed to the calling key on the spend spine" */
    it("records the customer price under the project's organization and the calling key", async () => {
      const recorded: GatewayPricedSpend[] = [];
      await withInstallation(
        {
          gateway: {
            recordPricedSpend: async (input) => {
              recorded.push(input);
              return { status: "recorded" };
            },
          },
        },
        async (api) => {
          await api.recordSpendForHostedCalls(HOSTED_SPEND);
        },
      );

      expect(recorded).toEqual([
        expect.objectContaining({
          projectId: PROJECT,
          organizationId: ORGANIZATION,
          teamId: "team-1",
          virtualKeyId: "vk-connect",
          inputTokens: 2_000_000,
          costNanoUsd: 4_000_000_000,
        }),
      ]);
    });
  });

  describe("when the spend spine is not registered", () => {
    /** @scenario "Hosted spend is refused while the spend spine is not registered" */
    it("throws, so the caller keeps the spend and tries again", async () => {
      await withInstallation(
        { gateway: { recordPricedSpend: async () => ({ status: "unavailable" }) } },
        async (api) => {
          await expect(api.recordSpendForHostedCalls(HOSTED_SPEND)).rejects.toThrow(
            /spend pipeline is not registered/,
          );
        },
      );
    });
  });
});

describe("given an organization's own Instant Evals switch", () => {
  describe("when a member who may manage the organization reads the offer", () => {
    it("offers the switch on the hosted service", async () => {
      const access = await withInstallation({ isReleased: false }, (api) =>
        api.getOptInAccess({ projectId: PROJECT, userId: "member-1" }),
      );

      expect(access).toEqual({ released: false, offer: "enable" });
    });
  });

  describe("when a member who may not manage the organization reads the offer", () => {
    it("tells them to ask an admin", async () => {
      const access = await withInstallation(
        { isReleased: false, mayManageOrganization: false },
        (api) => api.getOptInAccess({ projectId: PROJECT, userId: "member-1" }),
      );

      expect(access.offer).toBe("ask_admin");
    });
  });

  describe("when the switch is thrown", () => {
    it("records the project's own organization and the member", async () => {
      const recorded: unknown[] = [];
      const access = await withInstallation(
        {
          isReleased: false,
          recordOptIn: async (input) => {
            recorded.push(input);
          },
        },
        (api) => api.optIn({ projectId: PROJECT, userId: "member-1" }),
      );

      expect(access).toEqual({ released: true, offer: "enable" });
      expect(recorded).toEqual([{ organizationId: ORGANIZATION, userId: "member-1" }]);
    });
  });

  describe("when an enterprise organization's switch is thrown", () => {
    it("refuses it by code and records nothing", async () => {
      const recorded: unknown[] = [];

      await expect(
        withInstallation(
          {
            isReleased: false,
            planType: "ENTERPRISE",
            recordOptIn: async (input) => {
              recorded.push(input);
            },
          },
          (api) => api.optIn({ projectId: PROJECT, userId: "member-1" }),
        ),
      ).rejects.toMatchObject({ code: "instant_eval_opt_in_not_offered" });
      expect(recorded).toEqual([]);
    });
  });
});
