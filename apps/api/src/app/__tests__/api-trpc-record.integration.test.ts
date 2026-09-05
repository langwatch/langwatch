/**
 * The packaged tRPC record itself, served by the API process.
 *
 * What this pins is the record rather than any one surface inside it: that a
 * complete collaborator set mounts every namespace it declares, that an
 * incomplete one composes NOTHING and names the half that is missing, and that
 * a SUBSCRIPTION in the record resolves over the `/api/sse` lane on the SAME
 * root `/api/trpc` serves.
 *
 * Each feature's own answers are pinned beside that feature — the annotation
 * queueing, the privacy snapshot, the support inbox and the setup checklist
 * each have a suite in `src/features/<feature>/__tests__`.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { EventEmitter } from "node:events";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication, MissingAgentService, MissingSecretService } from "../../api.application";
import { ApiAuditPort } from "../../api-request.policy";
import { ApiRestSecurity } from "../../api-rest.security";
import { createSseSubscriptionApp } from "../../app-trpc/app-trpc.sse";
import { sameOriginSseInit } from "../../app-trpc/__tests__/support/sse-browser-request";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";
import { ApiTrpcCollaboratorsAbsence } from "../../app-trpc/app-trpc.collaborators";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  stub,
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
  stubMount,
} from "./api-trpc-record.test-doubles";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";

/** Every namespace `createAppTrpcFeatures` mounts, as the wire names them. */
const RECORD_NAMESPACES = [
  "activityMonitor",
  "aiTools",
  "analytics",
  "annotation",
  "annotationScore",
  "anomalyRules",
  "apiKey",
  "authz",
  "automation",
  "batchRecord",
  "bugReports",
  "codingAgents",
  "costs",
  "currency",
  "dashboards",
  "dataPrivacy",
  "dataRetention",
  "dataset",
  "datasetRecord",
  "departments",
  "emailSuppression",
  "evaluations",
  "evaluators",
  "experiments",
  "export",
  "featureFlag",
  "frontDoor",
  "gatewayBudgets",
  "gatewayCacheRules",
  "gatewayGuardrails",
  "gatewaySpendEvents",
  "gatewayUsage",
  "github",
  "governance",
  "graphs",
  "group",
  "home",
  "httpProxy",
  "identity",
  "ingestionKey",
  "ingestionSources",
  "ingestionTemplates",
  "integrationsChecks",
  "joinRequests",
  "langy",
  "langyEgress",
  "license",
  "licenseEnforcement",
  "limits",
  "llmModelCost",
  "modelProvider",
  "monitors",
  "onboarding",
  "ops",
  "optimization",
  "organization",
  "personalSessions",
  "personalVirtualKeys",
  "personalWorkspaceFeatures",
  "pinnedTrace",
  "plan",
  "presence",
  "project",
  "promptTags",
  "prompts",
  "publicEnv",
  "role",
  "roleBinding",
  "routingPolicy",
  "savedViews",
  "scenarios",
  "scimToken",
  "sessionPolicy",
  "setupSkills",
  "share",
  "sharedTrace",
  "spans",
  "ssoConnections",
  "storedObjects",
  "subscription",
  "suites",
  "team",
  "topics",
  "traceEditOverlay",
  "traces",
  "tracesV2",
  "translate",
  "user",
  "virtualKeys",
  "webhookEndpoints",
  "workflow",
] as const;

/** The rows the record's own surfaces read while it is being built. */
function testPrisma() {
  return { client: {} as unknown as PrismaClient };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

class RecordingAudit extends ApiAuditPort {
  readonly entries: Array<{ path: string; input: unknown }> = [];

  async record(event: unknown): Promise<void> {
    this.entries.push(event as { path: string; input: unknown });
  }
}

function composeApplication() {
  const prisma = testPrisma();
  const broadcast = new EventEmitter();
  const audit = new RecordingAudit();

  const collaborators = stubCollaborators({}, broadcast);

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: stubComposedFeatures(),
    infrastructure: {
      ...stubInfrastructureEntitlements(),
      prisma: prisma.client,
      authz: testAuthz(),
      audit,
    },
    collaborators,
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
      audit: async (event) => {
        await audit.record(event);
      },
      subscriptions: (ports) =>
        createSseSubscriptionApp({ security: subscriptionSecurity(), ports }).hono,
    },
  });

  return { application, prisma, broadcast, audit, features };
}

/** The lane's own security; its credential services are never reached here. */
function subscriptionSecurity() {
  return ApiRestSecurity.create({
    apiKeys: stub("apiKeys"),
    authz: testAuthz(),
    organizations: stub("organizations"),
    observability: ApiRestObservabilityComposition.create(),
  });
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
  method: "query" | "mutation" = "query",
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const url = `http://127.0.0.1/api/trpc/${path}`;
  const response =
    method === "mutation"
      ? await application.hono.request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        })
      : await application.hono.request(
          `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
        );
  return { status: response.status, body: await response.json() };
}

/** Waits for a condition the stream reaches on its own, or gives up loudly. */
async function waitFor(reached: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!reached()) {
    if (Date.now() > deadline) throw new Error("the subscription never attached its listener");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The superjson frames of one SSE response, in order. */
function framesOf(body: string): unknown[] {
  return body
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n"),
    )
    .filter((payload) => payload.length > 0)
    .map((payload) => superjson.parse(payload));
}

describe("given an API process composed with the packaged tRPC record", () => {
  describe("when a client watches an export over the subscription lane", () => {
    /** @scenario "A subscription in the record is watchable on the same root" */
    it("resolves the path against the same root the tRPC endpoint serves", async () => {
      const { application, broadcast } = composeApplication();
      if (!application.hono) throw new Error("HTTP composition was not created.");

      const input = encodeURIComponent(
        superjson.stringify({ projectId: PROJECT_ID, exportId: "export-1" }),
      );
      const response = await application.hono.request(
        `/api/sse/export.onExportProgress?input=${input}`,
        sameOriginSseInit(),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");

      // The body has to be consumed for the relay to run at all, and the relay
      // attaches its listener only once it does — so the event is published
      // after the stream is live rather than into an emitter nobody watches.
      const body = response.text();
      await waitFor(() => broadcast.listenerCount("export_progress") > 0);
      broadcast.emit("export_progress", {
        event: JSON.stringify({ exportId: "export-1", type: "done" }),
        timestamp: Date.now(),
      });

      const frames = framesOf(await body);
      expect(frames[0]).toEqual({ type: "connected" });
      expect(frames[1]).toMatchObject({ exportId: "export-1", type: "done" });
      expect(frames.at(-1)).toEqual({ type: "complete" });
    });
  });

  describe("when every feature has composed the application slice it owns", () => {
    /** @scenario "A complete collaborator set mounts the whole record" */
    it("mounts every namespace the record declares, with no absence", () => {
      const { features } = composeApplication();

      const record = features.build(stubMount());

      expect(Object.keys(record).sort()).toEqual([...RECORD_NAMESPACES].sort());
      expect(RECORD_NAMESPACES).toHaveLength(91);
    });
  });

  describe("when the process composed no application for the record to read", () => {
    /** @scenario "An incomplete collaborator set composes no record and names the gap" */
    it("composes no record and names the reason", () => {
      const reported: string[] = [];
      const report = new (class extends ApiTrpcCollaboratorsAbsence {
        absent(reason: "no-collaborators" | "no-database"): void {
          reported.push(reason);
        }
      })();

      const composed = ApiTrpcFeaturesComposition.tryCompose({
        composed: stubComposedFeatures(),
        infrastructure: {
          ...stubInfrastructureEntitlements(),
          prisma: testPrisma().client,
          authz: testAuthz(),
          audit: undefined,
        },
        collaborators: undefined,
        report,
      });

      expect(composed).toBeUndefined();
      // Named by REASON: "the record did not mount" is a symptom a missing
      // database and a missing application share, and which one it was is what
      // an operator can act on.
      expect(reported).toEqual(["no-collaborators"]);
    });
  });
});
