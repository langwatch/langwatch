/**
 * @vitest-environment node
 * A relayed turn's body is the caller's, so its bindings must be the organization's alone, signed,
 * on the HTTP and the Lambda route. @see specs/security/org-private-model-endpoints.feature
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import {
  type ModelProviderApi,
  PRIVATE_ENDPOINTS_HEADER,
  PRIVATE_ENDPOINTS_PROJECT_HEADER,
  signPrivateEndpointsHeaders,
} from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { HttpWorkflowNlpRuntimeAdapter } from "../../channels/http/http.workflow-nlp-runtime.channel.ts";
import type { NlpLambdaInvoke } from "../../channels/nlp-lambda.channel.ts";
import { WorkflowEnginePrivateEndpointsService } from "../../services/workflow-engine-private-endpoints.service.ts";
import { WorkflowExecuteSyncRelayService } from "../../services/workflow-execute-sync-relay.service.ts";
import { workflowExecuteSyncRest } from "../workflow-execute-sync.rest.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};
const FORGED = [{ hostname: "evil.test", addresses: ["10.0.0.1"], port: 443 }];
const FORGED_HEADER = "forged.envelope";

/** A test-only Ed25519 seed (0x01..0x20). */
const TEST_SEED = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";

/** The organization's bindings, signed for acme-prod the way the model-provider module does. */
const ORG_HEADERS = await signPrivateEndpointsHeaders({
  organizationId: "org_acme",
  projectId: "acme-prod",
  bindings: [INFERENCE],
  signingKey: TEST_SEED,
});

const WORKFLOW = { nodes: [], edges: [], api_key: "sk-lw-key" };

/** What reached the engine: the request's headers and its parsed body. */
type EngineRequest = { headers: Record<string, string>; body: unknown };

function lowerCased(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

/** The engine on a plain address, reached over `fetch`. */
function httpEngine(sent: EngineRequest[]) {
  return HttpWorkflowNlpRuntimeAdapter.create({
    serviceUrl: "http://nlp.test",
    internalSecret: "internal",
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push({
        headers: lowerCased(init.headers as Record<string, string>),
        body: JSON.parse(init.body as string),
      });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
}

/** The project's own Lambda, invoked with a Lambda Web Adapter HTTP event. */
function lambdaEngine(sent: EngineRequest[]) {
  const lambda: NlpLambdaInvoke = {
    invoke: async ({ payload }) => {
      const event = JSON.parse(payload) as { headers: Record<string, string>; body: string };
      sent.push({ headers: lowerCased(event.headers), body: JSON.parse(event.body) });
      return { statusCode: 200, payload: "{}" };
    },
  };
  return HttpWorkflowNlpRuntimeAdapter.onProjectFunctions({
    functions: { arnFor: async () => "arn:aws:lambda:eu-west-1:000000000000:function:nlp" },
    lambda,
    internalSecret: "internal",
  });
}

function mount({ engine, projectId }: { engine: "http" | "lambda"; projectId: string }) {
  const sent: EngineRequest[] = [];
  const bindings = WorkflowEnginePrivateEndpointsService.create({
    modelProviders: createApiFixture<ModelProviderApi>({
      privateEndpointsHeadersForProject: async (input) =>
        input.projectId === "acme-prod" ? ORG_HEADERS : {},
    }),
  });
  const relay = WorkflowExecuteSyncRelayService.create({
    runtime: bindings.boundRuntime(engine === "http" ? httpEngine(sent) : lambdaEngine(sent)),
    turnCeilingMs: 60_000,
  });
  const app = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: { authenticate: () => ({ actor: null, scope: { tier: "project", id: projectId } }) },
  }).mount(workflowExecuteSyncRest.router(), {
    app: () =>
      createApiFixture<WorkflowApi>(
        { relayExecuteSync: (input) => relay.relay(input) },
        "WorkflowApi",
      ),
    credential: "project",
    onError: canonicalErrorResponse,
  });
  return { app, sent };
}

async function relayTurn(input: {
  engine: "http" | "lambda";
  projectId: string;
  body: object;
  headers?: Record<string, string>;
}): Promise<EngineRequest> {
  const { app, sent } = mount(input);
  const response = await app.request("/api/scenario/execute-sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-token": "sk-lw-key", ...input.headers },
    body: JSON.stringify(input.body),
  });
  expect(response.status).toBe(200);
  expect(sent).toHaveLength(1);
  return sent[0]!;
}

const header = PRIVATE_ENDPOINTS_HEADER.toLowerCase();
const projectHeader = PRIVATE_ENDPOINTS_PROJECT_HEADER.toLowerCase();
const ORG_HEADER = ORG_HEADERS[PRIVATE_ENDPOINTS_HEADER];

const BODIES: Record<string, { body: object; runsGraph: boolean }> = {
  "a flat body with a top-level field": {
    body: { trace_id: "t", workflow: WORKFLOW, private_endpoints: FORGED },
    runsGraph: true,
  },
  "a payload with the field and no workflow": {
    body: { type: "execute_component", payload: { private_endpoints: FORGED } },
    runsGraph: false,
  },
  "a discriminated envelope with the field at the top and in the payload": {
    body: {
      type: "execute_flow",
      private_endpoints: FORGED,
      payload: { workflow: WORKFLOW, private_endpoints: FORGED },
    },
    runsGraph: true,
  },
};

describe("POST /api/scenario/execute-sync and private endpoint bindings", () => {
  for (const engine of ["http", "lambda"] as const) {
    describe(`given the project's engine on the ${engine} route`, () => {
      for (const [name, { body, runsGraph }] of Object.entries(BODIES)) {
        describe(`when the turn is ${name}`, () => {
          /** @scenario "A relayed workflow turn cannot choose its own bindings" */
          it("sends no private_endpoints field and only the organization's bindings", async () => {
            const sent = await relayTurn({ engine, projectId: "acme-prod", body });

            expect(JSON.stringify(sent.body)).not.toContain("private_endpoints");
            expect(JSON.stringify(sent)).not.toContain("evil.test");
            expect(sent.headers[header]).toBe(runsGraph ? ORG_HEADER : undefined);
            expect(sent.headers[projectHeader]).toBe(runsGraph ? "acme-prod" : undefined);
          });

          it("sends no bindings at all for an organization that bound none", async () => {
            const sent = await relayTurn({ engine, projectId: "rival-prod", body });

            expect(JSON.stringify(sent.body)).not.toContain("private_endpoints");
            expect(sent.headers[header]).toBeUndefined();
          });
        });
      }

      describe("when the caller sends its own private endpoints header", () => {
        const body = { type: "execute_flow", payload: { workflow: WORKFLOW } };

        it("replaces it with the organization's bindings", async () => {
          const sent = await relayTurn({
            engine,
            projectId: "acme-prod",
            body,
            headers: {
              [PRIVATE_ENDPOINTS_HEADER]: FORGED_HEADER,
              [PRIVATE_ENDPOINTS_PROJECT_HEADER]: "rival-prod",
            },
          });

          expect(sent.headers[header]).toBe(ORG_HEADER);
          expect(sent.headers[projectHeader]).toBe("acme-prod");
        });

        it("forwards nothing for an organization that bound none", async () => {
          const sent = await relayTurn({
            engine,
            projectId: "rival-prod",
            body,
            headers: {
              [PRIVATE_ENDPOINTS_HEADER]: FORGED_HEADER,
              [PRIVATE_ENDPOINTS_PROJECT_HEADER]: "acme-prod",
            },
          });

          expect(sent.headers[header]).toBeUndefined();
          expect(sent.headers[projectHeader]).toBeUndefined();
        });
      });
    });
  }
});
