/**
 * The plan allowance the packaged families' one metered door is gated on.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { composeEnterpriseGovernanceApplication } from "../../features/enterprise/enterprise-governance.composition.ts";
import { composeApiPackagedRest } from "../api-packaged-rest.composition.ts";
import type { ApiPackagedRestCompositionOptions } from "../api-packaged-rest.composition.ts";
import type { ApiTraceIngestComposition } from "../api-trace-ingest.composition.ts";
import { refusingAnalyticsFeature } from "../../features/analytics/analytics.composition.ts";
import { refusingDatasetFeature } from "../../features/dataset/dataset.composition.ts";
import { refusingExperimentFeature } from "../../features/experiment/experiment.composition.ts";
import { refusingWorkflowFeature } from "../../features/workflow/workflow.composition.ts";
import {
  stubDashboardFeature,
  stubEvaluatorFeature,
  stubMonitorFeature,
  stubScenarioFeature,
  stubPresenceFeature,
  stubStoredObjectFeature,
} from "./api-trpc-record.test-doubles.ts";
import { refusingOrganizationFeature } from "../../features/organization/organization.composition.ts";
import { refusingAutomationFeature } from "../../features/automation/automation.composition.ts";
import { CodingAgentApp } from "@langwatch/coding-agent-server";
import { createCodingAgentTrpcRouter } from "../../features/coding-agent/coding-agent-trpc.mount.ts";
import { refusingEnterpriseFeature } from "../../features/enterprise/enterprise.composition.ts";


const project = {
  id: "project-1",
  slug: "acme",
  name: "Acme",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

/** A plan limit as the entitlement package raises it: terminal, not retryable. */
class TestPlanLimitExceededError extends Error {
  readonly httpStatus = 402;
}

function composeGuard(usageLimit: ApiTraceIngestComposition["usageLimit"] | undefined) {
  const logger = { warn: vi.fn(), error: vi.fn() };
  const collaborators = composeApiPackagedRest({
    agents: undefined,
    connectedAgents: undefined,
    monitor: stubMonitorFeature(),
    scenario: stubScenarioFeature(),
    storedObject: stubStoredObjectFeature(),
    analytics: refusingAnalyticsFeature(),
    authz: { authorizeProjectPermission: async () => undefined } as never,
    credentials: { authenticate: async () => null } as never,
    encryption: undefined,
    experiment: refusingExperimentFeature(),
    workflow: refusingWorkflowFeature(),
    enterpriseGovernance: composeEnterpriseGovernanceApplication(undefined),
    presence: stubPresenceFeature(),
    organization: refusingOrganizationFeature(),
    automation: refusingAutomationFeature(),
    codingAgent: {
      app: CodingAgentApp.refusing(),
      router: (mount) => createCodingAgentTrpcRouter(mount.runtime),
    },
    enterprise: refusingEnterpriseFeature(),
    dataset: refusingDatasetFeature(),
    evaluator: stubEvaluatorFeature(),
    dashboard: stubDashboardFeature(),
    legacyErrors: (error) => {
      throw error;
    },
    plans: undefined,
    publicBaseUrl: undefined,
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    redis: undefined,
    session: undefined,
    traceIngest: usageLimit ? ({ usageLimit } as ApiTraceIngestComposition) : undefined,
    apiKeys: {} as never,
    organizations: {} as never,
    projects: undefined,
    modelProviders: undefined,
    requireApiKeyPermission: () =>
      (async (_c, next) => {
        await next();
      }) as MiddlewareHandler,
    audit: undefined,
    managementAudit: () => {},
    isSaas: false,
    instanceAdminKey: () => undefined,
    logger,
  } satisfies ApiPackagedRestCompositionOptions);

  return { guard: collaborators.ports.traceUsageGuard, logger };
}

/** Drives the guard the way the scenario-event route does. */
async function callThroughGuard(options: {
  guard: MiddlewareHandler;
  withProject: boolean;
}): Promise<{ status: number; reached: boolean }> {
  let reached = false;
  const app = new Hono();
  app.onError((error) =>
    error instanceof TestPlanLimitExceededError
      ? new Response("plan limit", { status: error.httpStatus })
      : new Response("failed", { status: 500 }),
  );
  const setProject: MiddlewareHandler = async (c, next) => {
    if (options.withProject) c.set("project", project);
    await next();
  };
  app.post("/", setProject, options.guard, (c) => {
    reached = true;
    return c.json({ written: true });
  });
  const response = await app.request("/", { method: "POST" });
  return { status: response.status, reached };
}

describe("given the packaged REST families are composed", () => {
  describe("when this process composed the ingest gate", () => {
    /** @scenario "Reporting a scenario event over the allowance is refused" */
    it("refuses a write from a team that has spent its allowance", async () => {
      const usageLimit = vi.fn(async () => {
        throw new TestPlanLimitExceededError("over the cap");
      });
      const { guard } = composeGuard(usageLimit);

      const { status, reached } = await callThroughGuard({ guard, withProject: true });

      expect(usageLimit).toHaveBeenCalledWith({ project });
      expect(reached).toBe(false);
      expect(status).toBe(402);
    });

    /** @scenario "Reporting a scenario event within the allowance is accepted" */
    it("writes when the team is within its allowance", async () => {
      const usageLimit = vi.fn(async () => undefined);
      const { guard } = composeGuard(usageLimit);

      const { status, reached } = await callThroughGuard({ guard, withProject: true });

      expect(usageLimit).toHaveBeenCalledWith({ project });
      expect(reached).toBe(true);
      expect(status).toBe(200);
    });

    it("reports its own mounting defect rather than dropping the write", async () => {
      const usageLimit = vi.fn(async () => undefined);
      const { guard, logger } = composeGuard(usageLimit);

      const { reached } = await callThroughGuard({ guard, withProject: false });

      expect(usageLimit).not.toHaveBeenCalled();
      expect(reached).toBe(true);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("when this process composed no ingest gate", () => {
    /** @scenario "A deployment that meters nothing still accepts the event" */
    it("accepts the write rather than refusing what it cannot meter", async () => {
      const { guard } = composeGuard(undefined);

      const { status, reached } = await callThroughGuard({ guard, withProject: true });

      expect(reached).toBe(true);
      expect(status).toBe(200);
    });
  });
});
