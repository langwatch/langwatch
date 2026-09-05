/**
 * @vitest-environment node
 * @see specs/scenarios/simulation-run-model-resolution.feature
 * @see specs/model-providers/codex-account-provider.feature
 */

/*
 * A project whose FAST / coding-default role is pinned to a codex model must
 * still run workflow, code and http simulations. They consume no LLM key for the
 * agent under test, so the prefetch must resolve no adapter-role model at all.
 */

/*
 * The graph here is REAL: the tenancy services, the model gateway, the resolver
 * and the provider rows, over native Postgres. Nothing overrides the model-params
 * boundary — faking it would hide the failure this test exists to catch.
 */
import { randomUUID } from "node:crypto";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { CODEX_DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import { SimulationService, type TargetConfig } from "@langwatch/scenario-contract";
import { cleanupTestRows } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveWorkerStoredSecretCipher } from "../app/worker-automation-graph.composition";
import { createWorkerModelProviders } from "../app/worker-model-provider.composition";
import {
  createWorkerScenarioExecutionPrefetcher,
  type WorkerScenarioPrefetcherPrerequisites,
} from "../app/worker-scenario-execution.composition";
import { createWorkerTenancy } from "../app/worker-tenancy.composition";
import { resolveWorkerConfig, type WorkerConfig } from "../platform/config/worker.config";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
/** The key every stored credential in this fixture is written and read under. */
const ENCRYPTION_KEY = "0".repeat(64);

const connection: PrismaConnection | null = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database() {
  if (!connection) {
    throw new Error("LANGWATCH_TEST_DATABASE_URL is required for the codex coding defaults test");
  }
  return connection.client;
}

const namespace = `codex-coding-${randomUUID().slice(0, 8)}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let userId = "";
let scenarioId = "";
let workflowId = "";
let workflowAgentId = "";
let codeAgentId = "";
let httpAgentId = "";
let prerequisites: WorkerScenarioPrefetcherPrerequisites;

function workerConfig(): WorkerConfig {
  return resolveWorkerConfig({
    NODE_ENV: "test",
    CREDENTIALS_SECRET: ENCRYPTION_KEY,
    LANGWATCH_NLP_SERVICE: "http://localhost:5561",
    BASE_HOST: "http://localhost:5560",
  });
}

describe.skipIf(!databaseUrl)(
  "prefetching a run on a project whose coding default is a codex model",
  () => {
    beforeAll(async () => {
      const db = database();
      const organization = await db.organization.create({
        data: { name: namespace, slug: namespace },
      });
      organizationId = organization.id;
      const team = await db.team.create({
        data: { name: namespace, slug: namespace, organizationId },
      });
      teamId = team.id;
      const project = await db.project.create({
        data: {
          name: namespace,
          slug: namespace,
          apiKey: `sk-lw-${namespace}`,
          teamId,
          language: "typescript",
          framework: "other",
        },
      });
      projectId = project.id;
      const user = await db.user.create({
        data: { name: `Codex ${namespace}`, email: `${namespace}@example.test` },
      });
      userId = user.id;

      const config = workerConfig();
      const encryption = resolveWorkerStoredSecretCipher(config);
      const tenancy = createWorkerTenancy({
        connection: connection!,
        encryption,
        redis: null,
        config,
      });
      const { modelProviders } = createWorkerModelProviders({
        config,
        database: db,
        redis: null,
        encryption,
        projects: tenancy.projects,
        organizations: tenancy.organizations,
        authorization: tenancy.authorization,
      });

      // A real, enabled OpenAI provider so the DEFAULT role — which the
      // simulator and judge always resolve — has real parameters.
      await modelProviders.upsert({
        projectId,
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: `sk-openai-${namespace}` },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });

      // A real, enabled codex provider so that a regression here fails as the
      // REPORTED failure — the codex coding-assistant backstop — rather than as
      // an unrelated "provider not found".
      await modelProviders.upsert({
        projectId,
        provider: "openai_codex",
        enabled: true,
        customKeys: {
          CODEX_ACCESS_TOKEN: `codex-access-${namespace}`,
          CODEX_REFRESH_TOKEN: `codex-refresh-${namespace}`,
          CODEX_ID_TOKEN: `codex-id-token-${namespace}`,
          CODEX_ACCOUNT_ID: `codex-account-${namespace}`,
          CODEX_PLAN: "pro",
          CODEX_EMAIL: `${namespace}@example.test`,
          CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
        },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });

      // Exactly the pair "apply coding defaults" writes for FAST, plus a
      // DEFAULT role default so the simulator and judge resolve. No actor: this
      // seeds the STATE that action produces rather than exercising the
      // permission-checked write path, which would test RBAC, not this seam.
      await modelProviders.setDefault({
        scope: { scopeType: "PROJECT", scopeId: projectId },
        key: "DEFAULT",
        model: "openai/gpt-5-mini",
      });
      await modelProviders.setDefault({
        scope: { scopeType: "PROJECT", scopeId: projectId },
        key: "FAST",
        model: CODEX_DEFAULT_MODEL,
      });

      const scenario = await db.scenario.create({
        data: {
          projectId,
          name: "Codex coding defaults scenario",
          situation: "User asks a question",
          criteria: ["Responds politely"],
          labels: [],
        },
      });
      scenarioId = scenario.id;

      const workflow = await db.workflow.create({
        data: { projectId, name: "Empty workflow", icon: "🤖", description: "" },
      });
      workflowId = workflow.id;
      const version = await db.workflowVersion.create({
        data: {
          projectId,
          workflowId,
          version: "1.0",
          commitMessage: "init",
          authorId: userId,
          // Empty nodes: the parameter hydration short-circuits to success, so
          // this fixture needs no per-node model wiring — it exists only to
          // prove the ADAPTER-role resolution is skipped.
          dsl: {
            spec_version: "1.5",
            version: "1.0",
            name: "Empty workflow",
            nodes: [],
            edges: [],
          },
        },
      });
      await db.workflow.update({
        where: { id: workflowId },
        data: { latestVersionId: version.id },
      });

      const workflowAgent = await db.agent.create({
        data: {
          projectId,
          name: "Workflow agent",
          type: "workflow",
          workflowId,
          config: { workflow_id: workflowId },
        },
      });
      workflowAgentId = workflowAgent.id;

      const codeAgent = await db.agent.create({
        data: {
          projectId,
          name: "Code agent",
          type: "code",
          config: {
            parameters: [
              {
                identifier: "code",
                type: "code",
                value: "def execute(input):\n    return input",
              },
            ],
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      });
      codeAgentId = codeAgent.id;

      const httpAgent = await db.agent.create({
        data: {
          projectId,
          name: "HTTP agent",
          type: "http",
          config: { url: "https://example.com/chat", method: "POST", headers: [] },
        },
      });
      httpAgentId = httpAgent.id;

      prerequisites = {
        config,
        connection: connection!,
        modelProviders,
        projects: tenancy.projects,
        // Never dialled: the prefetch resolves a target, its models and its
        // credentials, and reads no trace.
        resolveClickHouseClient: (() => {
          throw new Error("the prefetch must not read traces");
        }) as never,
        defaultRetentionDays: 30,
        langwatchEndpoint: "http://localhost:5560",
        nlpServiceUrl: "http://localhost:5561",
        encryptionKey: ENCRYPTION_KEY,
      };
    }, 120_000);

    afterAll(async () => {
      try {
        if (projectId) {
          // The workflow points at its latest version, so the version cannot go
          // while that pointer holds it.
          await database().workflow.updateMany({
            where: { projectId },
            data: { latestVersionId: null },
          });
          await cleanupTestRows(database(), [
            ["agent", { projectId }],
            ["scenario", { projectId }],
            ["workflowVersion", { projectId }],
            ["workflow", { projectId }],
            [
              "modelDefaultConfig",
              { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
            ],
            ["modelProvider", { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } }],
            ["project", { id: projectId }],
            ["team", { id: teamId }],
            ["user", { id: userId }],
            ["organization", { id: organizationId }],
          ]);
        }
      } finally {
        await connection?.closeOnce();
      }
    });

    describe.each([
      { label: "workflow" as const, referenceId: () => workflowAgentId },
      { label: "code" as const, referenceId: () => codeAgentId },
      { label: "http" as const, referenceId: () => httpAgentId },
    ])("when the run is against a $label target", ({ label, referenceId }) => {
      /** @scenario "A project whose FAST/coding default is codex still runs workflow, code, and http simulations" */
      it("prefetches successfully instead of hitting the codex coding-assistant backstop", async () => {
        const prefetcher = createWorkerScenarioExecutionPrefetcher({
          prerequisites,
          simulations: Object.create(SimulationService.prototype) as SimulationService,
        });
        const target: TargetConfig = { type: label, referenceId: referenceId() };

        const result = await prefetcher.prefetch({
          context: {
            projectId,
            scenarioId,
            setId: `set_${namespace}_${label}`,
            batchRunId: `batch_${namespace}_${label}`,
          },
          target,
        });

        expect(
          result.success,
          `prefetch failed for ${label} target: ${result.success ? "" : result.error}`,
        ).toBe(true);
      });
    });
  },
);
