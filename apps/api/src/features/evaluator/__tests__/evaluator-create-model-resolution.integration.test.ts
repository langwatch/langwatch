/**
 * The REST evaluator create resolves default models per role (#7556), over a
 * real Postgres and this process's own model gateway: DEFAULT and FAST seeded,
 * no EMBEDDINGS key ever issued.
 * @see specs/evaluators/evaluator-create-model-resolution.feature
 * @integration
 * @vitest-environment node
 */
import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
  PostgresAuthzAdapter,
} from "@langwatch/authz-server";
import { bindRestMiddleware, createRestRuntime, projectRestFacts } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import { EvaluatorApp, EvaluatorGraphPort, createEvaluatorRest } from "@langwatch/evaluator-server";
import { HandledError } from "@langwatch/handled-error";
import { expandLatestAlias } from "@langwatch/model-provider-contract";
import {
  GroupIdentityAdapter,
  OrganizationSettingsSecretPort,
  PersonalWorkspaceIdentityAdapter,
  PostgresOrganizationAdapter,
  TeamIdentityAdapter,
} from "@langwatch/organization-server";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectCredentialsAdapter } from "@langwatch/project-server";
import { createPrismaProjectApi } from "../../../app/__tests__/support/prisma-project-api.ts";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { WorkflowNlpRuntimePort } from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { composeApiModelProviders } from "../../../app/api-model-provider.composition.ts";
import {
  RestAuthWorld,
  type RestAuthProject,
} from "../../../app-rest/__tests__/support/rest-auth.world.ts";
import { composeEvaluatorService } from "../evaluator.composition.ts";

/** The tenancy middleware fences production reads; a fixture seeds across it. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** Organization settings ciphertext, which no evaluator create reads. */
class UnreadSettingsSecrets extends OrganizationSettingsSecretPort {
  encrypt(): string {
    throw new Error("organization settings are not read from an evaluator create");
  }

  decrypt(): string {
    throw new Error("organization settings are not read from an evaluator create");
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const ns = nanoid(8);
const ORGANIZATION_ID = `org-eval-models-${ns}`;
const TEAM_ID = `team-eval-models-${ns}`;
const PROJECT_ID = `project-eval-models-${ns}`;
const API_KEY = `sk-eval-models-${ns}`;

const project: RestAuthProject = {
  id: PROJECT_ID,
  name: `Eval Models ${ns}`,
  slug: `--proj-eval-${ns}`,
  teamId: TEAM_ID,
  organizationId: ORGANIZATION_ID,
  isPersonal: false,
  ownerUserId: null,
};

/**
 * A marker cipher. No provider credential is read on the default-resolution
 * path, and the real algorithm has its own suite.
 */
function testCipher(): SecretEncryptionPort {
  return {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => (value.startsWith("enc:") ? value.slice(4) : null),
  } as unknown as SecretEncryptionPort;
}

/** A workflow graph is never reached: this evaluator is a catalogue type. */
function unreachedWorkflows(): WorkflowService {
  return new Proxy({} as WorkflowService, {
    get: (_target, property) => () => {
      throw new Error(`workflows.${String(property)} is not reachable from a catalogue evaluator`);
    },
    has: () => true,
  });
}

/** No code evaluator runs here, so the engine is never dialled. */
function unreachedNlpRuntime(): WorkflowNlpRuntimePort {
  return new Proxy({} as WorkflowNlpRuntimePort, {
    get: (_target, property) => () => {
      throw new Error(`the NLP engine was dialled at ${String(property)}`);
    },
    has: () => true,
  });
}

/** A create in the caller's own project asks no cross-project permission. */
function unreachedPermissions(): AuthzApi {
  return new Proxy({} as AuthzApi, {
    get: (_target, property) => () => {
      throw new Error(`authz.${String(property)} is not reachable from an evaluator create`);
    },
    has: () => true,
  });
}

/** A catalogue evaluator has no workflow and no monitors to reach for. */
function unreachedGraph(): EvaluatorGraphPort {
  return new Proxy({} as EvaluatorGraphPort, {
    get: (_target, property) => () => {
      throw new Error(`graph.${String(property)} is not reachable from an evaluator create`);
    },
    has: () => true,
  });
}

function mountEvaluatorsFamily() {
  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  const authz = PostgresAuthzAdapter.create({
    database: prisma,
    // No epoch cache: the fixture seeds its rows mid-suite, and a decision
    // cached before the seed would answer for a tenant that did not exist.
    redis: null,
    dispatcher: EventingAuthzCommandDispatcherAdapter.create(),
    newBindingId: () => bindingIds.newBindingId(),
    cacheEnabled: () => false,
  }).build();
  const authorization = authz.authz;
  const organizations = PostgresOrganizationAdapter.create({
    database: prisma,
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    authz: authorization,
    grants: authz.grants,
    settingsSecrets: new UnreadSettingsSecrets(),
  }).build();
  const projects = createPrismaProjectApi({
    database: prisma,
    credentials: ProjectCredentialsAdapter.create(),
    organizations,
  });

  const modelProviders = composeApiModelProviders({
    prisma,
    projects,
    organizations,
    authorization,
    encryption: testCipher(),
    rateLimit: async () => ({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 }),
    environment: {},
    isSaas: false,
    egress: { blockLocal: true, allowedHosts: [], verifyTls: true },
    nlpServiceUrl: "http://127.0.0.1:5561",
    processName: "langwatch-api-test",
  });

  const evaluators = composeEvaluatorService({
    infrastructure: { prisma } as Parameters<typeof composeEvaluatorService>[0]["infrastructure"],
    peers: { workflows: unreachedWorkflows(), nlpRuntime: unreachedNlpRuntime() },
  });

  const app = EvaluatorApp.create({
    evaluators,
    modelProviders,
    // A create asks nobody's permission in another project and reads no
    // workflow: this scenario is the model cascade and nothing else.
    permissions: unreachedPermissions(),
    graph: unreachedGraph(),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: PROJECT_ID } as const }),
    },
  });

  return runtime.mount(
    createEvaluatorRest(
      ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    ).router(),
    {
      app: () => app,
      credential: "projectKey",
      onError: (error, c) =>
        HandledError.isHandled(error)
          ? c.json({ error: error.code, message: error.message }, error.httpStatus as 400)
          : c.json({ error: "internal_server_error", message: String(error) }, 500),
      facts: [
        bindRestMiddleware(projectRestFacts, () => ({
          projectSlug: project.slug,
          viewerUserId: null,
          actorId: API_KEY,
        })),
      ],
    },
  );
}

const describeWithDatabase = describe.skipIf(connection === null);

describeWithDatabase(
  "given an organization whose default models carry DEFAULT and FAST but no EMBEDDINGS",
  () => {
    let family: ReturnType<typeof mountEvaluatorsFamily>;

    const post = (body: unknown) =>
      family.request("/api/evaluators", {
        method: "POST",
        headers: { ...RestAuthWorld.bearer(API_KEY), "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    beforeAll(async () => {
      await prisma.organization.create({
        data: { id: ORGANIZATION_ID, name: `Eval Models Org ${ns}`, slug: `--test-eval-${ns}` },
      });
      await prisma.team.create({
        data: {
          id: TEAM_ID,
          name: `Team ${ns}`,
          slug: `--team-eval-${ns}`,
          organizationId: ORGANIZATION_ID,
        },
      });
      await prisma.project.create({
        data: {
          id: PROJECT_ID,
          name: project.name,
          slug: project.slug,
          apiKey: API_KEY,
          teamId: TEAM_ID,
          language: "en",
          framework: "test",
        },
      });
      await prisma.modelDefaultConfig.create({
        data: {
          id: `mdc_${nanoid()}`,
          organizationId: ORGANIZATION_ID,
          config: { DEFAULT: "anthropic/latest", FAST: "anthropic/latest-mini" },
          scopes: {
            create: [
              {
                id: `mdcs_${nanoid()}`,
                scopeType: "ORGANIZATION",
                scopeId: ORGANIZATION_ID,
              },
            ],
          },
        },
      });

      family = mountEvaluatorsFamily();
    });

    afterAll(async () => {
      if (connection === null) return;
      await prisma.evaluator.deleteMany({ where: { projectId: PROJECT_ID } });
      await prisma.modelDefaultConfig.deleteMany({ where: { organizationId: ORGANIZATION_ID } });
      await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
      await prisma.team.deleteMany({ where: { id: TEAM_ID } });
      await prisma.organization.deleteMany({ where: { id: ORGANIZATION_ID } });
    });

    describe("when creating an evaluator whose settings carry no embeddings_model", () => {
      /** @scenario A faithfulness evaluator is created with no embeddings default configured */
      it("creates it and fills the chat model from the organization's default", async () => {
        const response = await post({
          name: `Faithfulness ${ns}`,
          config: { evaluatorType: "ragas/faithfulness" },
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          config: { settings: Record<string, unknown> };
        };
        // The stored config holds the `anthropic/latest` alias; the resolver
        // expands it to the catalog's current flagship on the way out, so the
        // expectation is the expansion rather than a pinned model id that a
        // catalog release would break.
        expect(body.config.settings.model).toBe(expandLatestAlias("anthropic/latest"));
        expect(body.config.settings).not.toHaveProperty("embeddings_model");
      });
    });
  },
);
