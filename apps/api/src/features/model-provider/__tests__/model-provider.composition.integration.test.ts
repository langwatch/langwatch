/**
 * The provider surfaces, served by the API process.
 *
 * What this pins is what the deployment's HOST answers and what it refuses:
 * the model registry's own ceilings read over the REAL `/api/trpc` handler,
 * the catastrophic-backtracking gate the cost-rule schemas are built from, and
 * the conservative stand-in a process with no host falls back to.
 *
 * The gate is the one capability that cannot degrade at call time — the write
 * and preview SCHEMAS are built from it — so a process with no host must
 * refuse the dangerous shape rather than say yes to everything.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { composeApiModelProviderHost } from "../../../app/api-model-provider-host.composition";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";
import { composeModelProviderFeature } from "../model-provider.composition";

const SESSION_USER = { id: "user-1", email: "sam@acme.test", role: "ADMIN" };

function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/** The real host, behind the same egress fence the gateway's own probe runs on. */
function realHost() {
  return composeApiModelProviderHost({
    egress: { blockLocal: true, allowedHosts: [], verifyTls: true },
    environment: {},
    processName: "langwatch-api",
  });
}

function composeApplication(options: { host?: ReturnType<typeof realHost> } = {}) {
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: {} as unknown as PrismaClient,
    authz: testAuthz(),
    audit: undefined,
  };
  const modelProvider = composeModelProviderFeature({
    infrastructure,
    ...(options.host ? { host: options.host } : {}),
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), modelProvider },
    infrastructure,
    collaborators: stubCollaborators({
      modelProviders: modelProvider.app,
    }),
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

  return { application, modelProvider };
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

describe("given an API process composed with the provider surfaces", () => {
  describe("when a model's ceilings are read through the real handler", () => {
    it("answers the registry's own limits rather than null", async () => {
      const { application } = composeApplication({ host: realHost() });

      const { status, body } = await callTrpc(application, "llmModelCost.getModelLimits", {
        projectId: "project-1",
        model: "openai/gpt-5-mini",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { maxInputTokens: expect.any(Number) } } },
      });
    });
  });

  describe("when a catastrophic-backtracking pattern reaches the cost-rule preview", () => {
    /**
     * The gate is read while the PROCEDURE is built — it becomes the input
     * parser's own refinement — so what it answers is observable as a rejected
     * request rather than as a returned boolean.
     */
    it("refuses the dangerous pattern where the host's real gate is composed", async () => {
      const { application } = composeApplication({ host: realHost() });

      const refused = await callTrpc(application, "llmModelCost.previewMatchingSpans", {
        projectId: "project-1",
        regex: "(a+)+$",
      });

      expect(refused.status).toBe(400);
    });

    it("refuses it on a process with no host rather than allowing everything", async () => {
      const { application } = composeApplication();

      const refused = await callTrpc(application, "llmModelCost.previewMatchingSpans", {
        projectId: "project-1",
        regex: "(a+)+$",
      });
      // A safe pattern gets past the parser and reaches the preview, which is
      // the capability this deployment does not hold — a different answer, and
      // the point: the gate is not refusing everything.
      const allowed = await callTrpc(application, "llmModelCost.previewMatchingSpans", {
        projectId: "project-1",
        regex: "^gpt-5",
      });

      expect(refused.status).toBe(400);
      expect(allowed.status).not.toBe(400);
    });
  });
});
