/**
 * The setup checklist, served by the API process.
 *
 * What this pins is one call over the REAL `/api/trpc` handler on THIS
 * process's root, through THIS process's policy chain, against what
 * `composeIntegrationsChecksFeature` produced — and specifically WHICH code
 * issues the provider step's read.
 *
 * The rollup lives in this composition rather than in a feature package, and
 * it used to read `prisma.modelProvider` to fill its provider step. That table
 * holds every stored credential in the deployment, and the rule that only the
 * model-provider repository reads it is enforced by a lint over IMPORTS —
 * which a composition already holding the client walks straight past. So the
 * fake client below refuses every access to that delegate, and the step is
 * still answered: by the feature's own reader, which applies the PROJECT ->
 * TEAM -> ORGANIZATION cascade and selects an id rather than a credential
 * column.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import { PostgresModelProviderEvidenceAdapter } from "@langwatch/model-provider-server";
import type { ModelCostProjectPort } from "@langwatch/model-provider-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";
import { composeIntegrationsChecksFeature } from "../integrations-checks.composition";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/** The rows the checklist reads, plus the one delegate it must never reach. */
function testPrisma() {
  return {
    project: {
      findUnique: vi.fn(async () => ({
        id: PROJECT_ID,
        name: "Acme production",
        teamId: TEAM_ID,
        firstMessage: true,
        integrated: false,
        workflows: [{ id: "workflow-1" }],
        customGraphs: [],
        datasets: [],
        checks: [],
        triggers: [],
        team: {
          organizationId: ORGANIZATION_ID,
          members: [{ userId: SESSION_USER.id }, { userId: "user-2" }],
        },
      })),
    },
    // The provider step is NOT this connection's to answer. Every access to
    // the delegate refuses — a property read, not only a call — so a
    // composition that reaches for `prisma.modelProvider` at all fails here
    // rather than quietly reading a table whose credential column it has no
    // rules for.
    modelProvider: new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(
            `the checklist reached prisma.modelProvider.${String(property)}; the provider step is the model-provider feature's read`,
          );
        },
      },
    ),
    // The checklist's own probe beyond the project: a prompt with a version.
    llmPromptConfig: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;
}

function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/**
 * The provider step, as the process composes it: the REAL
 * `ModelProviderEvidenceService`, built by the model-provider package's own
 * adapter over its own client.
 *
 * Not a stub, because the seam being pinned is which code issues the read.
 */
function testProviderEvidence() {
  const findFirst = vi.fn(async () => ({ id: "provider-1" }));
  const port = PostgresModelProviderEvidenceAdapter.create({
    database: { modelProvider: { findFirst } } as unknown as Pick<PrismaClient, "modelProvider">,
    projects: {
      tryGetWithTeam: async () => ({
        id: PROJECT_ID,
        teamId: TEAM_ID,
        team: { organizationId: ORGANIZATION_ID },
      }),
      getWithTeam: async () => ({
        id: PROJECT_ID,
        teamId: TEAM_ID,
        team: { organizationId: ORGANIZATION_ID },
      }),
    } as unknown as ModelCostProjectPort,
  }).build();

  return { port, findFirst };
}

function composeApplication() {
  const providers = testProviderEvidence();
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: testPrisma(),
    authz: testAuthz(),
    audit: undefined,
  };
  const integrationsChecks = composeIntegrationsChecksFeature({
    infrastructure,
    modelProviders: providers.port,
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), integrationsChecks },
    infrastructure,
    collaborators: stubCollaborators(),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
    },
  });

  return { application, providers };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const response = await application.hono.request(
    `http://127.0.0.1/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
  );
  return { status: response.status, body: await response.json() };
}

describe("given an API process composed with the setup checklist", () => {
  describe("when the onboarding screens render it", () => {
    /** @scenario "All database access goes through the repository" */
    it("answers the provider step through the model-provider feature, not this connection", async () => {
      const { application, providers } = composeApplication();

      const { status, body } = await callTrpc(application, "integrationsChecks.getCheckStatus", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: {
          data: {
            json: {
              workflows: 1,
              customGraphs: 0,
              teamMembers: 2,
              modelProviders: 1,
              prompts: 0,
              // No scenario read composed, so the step reports not started
              // rather than guessing at "done".
              simulations: 0,
              firstMessage: true,
              integrated: false,
            },
          },
        },
      });

      expect(providers.findFirst).toHaveBeenCalledWith({
        where: {
          enabled: true,
          scopes: {
            some: {
              OR: [
                { scopeType: "PROJECT", scopeId: PROJECT_ID },
                { scopeType: "TEAM", scopeId: TEAM_ID },
                { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
              ],
            },
          },
        },
        select: { id: true },
      });
    });
  });
});
