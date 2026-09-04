/**
 * The plan allowance the packaged families' one metered door is gated on.
 *
 * The guard used to be composed as a middleware that called `next()` and
 * nothing else, so the scenario-event door accepted a write from a team that
 * had already spent its cap while the collector and the OTLP receiver refused
 * the same team's. What is under test is the WIRING: the port the families
 * receive has to be the ingest composition's own gate, not a second one and
 * not an empty one.
 *
 * The guard is driven through a real Hono request with the project variable
 * the access chain sets, because that read is the part a no-op could not have.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { composeApiPackagedRest } from "../api-packaged-rest.composition";
import type { ApiPackagedRestCompositionOptions } from "../api-packaged-rest.composition";
import type { ApiTraceIngestComposition } from "../api-trace-ingest.composition";

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
    agentGroup: undefined,
    analytics: undefined,
    authz: { authorizeProjectPermission: async () => undefined } as never,
    authzComposition: undefined,
    credentials: { authenticate: async () => null } as never,
    encryption: undefined,
    execution: undefined,
    gatewayGroup: undefined,
    identity: undefined,
    orgGroup: undefined,
    productGroup: undefined,
    productInfra: undefined,
    plans: undefined,
    publicBaseUrl: undefined,
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    redis: undefined,
    secrets: undefined,
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
  app.post(
    "/",
    async (c, next) => {
      if (options.withProject) c.set("project", project);
      await next();
    },
    options.guard,
    (c) => {
      reached = true;
      return c.json({ written: true });
    },
  );
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
