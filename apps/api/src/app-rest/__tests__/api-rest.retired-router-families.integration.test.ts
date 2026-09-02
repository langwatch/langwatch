/**
 * The families the retired `routes/misc.ts` and `routes/ops.ts` held, driven
 * through the real Hono app `createApiProcessRestFeatures` returns.
 *
 * They were one file because they were what nothing else claimed, not because
 * they belong together — five unrelated verticals sharing a `secured` handle.
 * Each is now its own family in the package that owns the capability, and what
 * is under test is that each kept the wire it published: the legacy analytics
 * path's own two 400 bodies, the DSPy log's seconds-vs-milliseconds refusal,
 * the OAuth-shaped refusals of the MCP approval step, and the image relay's
 * single opaque failure.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createApiProcessRestFeatures,
  type ApiProcessRestPorts,
  type ApiProcessRestServices,
} from "../app-rest.process-features";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

describe("given the legacy analytics path", () => {
  describe("when a project credential posts a series", () => {
    it("answers off the SAME application the canonical path resolves on", async () => {
      const getTimeseries = vi.fn(async () => ({ currentPeriod: [{ x: 1 }], previousPeriod: [] }));
      const api = mount({ services: { analytics: () => ({ getTimeseries }) as never } });

      const response = await api.fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: 1_767_225_600_000,
          timeZone: "UTC",
          series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        currentPeriod: [{ x: 1 }],
        previousPeriod: [],
      });
      expect(getTimeseries).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project-1" }),
      );
    });
  });

  describe("when the body fails validation", () => {
    it("answers ITS OWN sentence rather than the canonical path's envelope", async () => {
      const api = mount({ services: { analytics: () => ({ getTimeseries: vi.fn() }) as never } });

      const response = await api.fetch("/api/analytics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: "not-a-date", endDate: 1, series: [] }),
      });

      expect(response.status).toBe(400);
      // `{ error }`, which is what the two paths differ on: the canonical door
      // answers the framework's envelope for the same body.
      const body = (await response.json()) as Record<string, unknown>;
      expect(typeof body.error).toBe("string");
    });
  });
});

describe("given the DSPy optimizer's step log", () => {
  describe("when a batch of steps arrives", () => {
    it("prices every LLM call against the project's own stored rate before storing it", async () => {
      const upsertDspyStep = vi.fn(async (_step: StoredDspyStep) => {});
      const api = mount({ ports: dspyPorts({ upsertDspyStep }) });

      const response = await api.fetch("/api/dspy/log_steps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([dspyStep()]),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "ok" });
      const stored = upsertDspyStep.mock.calls[0]?.[0];
      // 100 prompt tokens at 2e-6 plus 50 completion tokens at 4e-6.
      expect(stored?.llmCalls[0]?.cost).toBeCloseTo(100 * 2e-6 + 50 * 4e-6, 12);
    });
  });

  describe("when a step's timestamp is in seconds rather than milliseconds", () => {
    it("refuses with the sentence that tells the SDK what to multiply", async () => {
      const upsertDspyStep = vi.fn(async (_step: StoredDspyStep) => {});
      const api = mount({ ports: dspyPorts({ upsertDspyStep }) });

      const response = await api.fetch("/api/dspy/log_steps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ ...dspyStep(), timestamps: { created_at: 1_767_225_600 } }]),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      });
      expect(upsertDspyStep).not.toHaveBeenCalled();
    });
  });

  describe("when this process composed no cost catalogue", () => {
    it("does not mount the family, rather than recording every run as free", () => {
      const api = mount({});

      expect(api.claims("/api/dspy/log_steps")).toBe(false);
    });
  });
});

describe("given the hosted MCP approval step", () => {
  describe("when a signed-in person approves a registered client", () => {
    it("mints a code bound to the project's credential and answers the client's redirect", async () => {
      const redis = fakeRedis({
        "mcp:oauth:client:client-1": JSON.stringify({
          redirectUris: ["https://client.test/cb"],
          clientName: "Editor",
        }),
      });
      const api = mount({ ports: { mcpAuthorize: mcpPorts(redis) } });

      const response = await api.fetch("/api/mcp/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          redirect_uri: "https://client.test/cb",
          client_id: "client-1",
          code_challenge: "challenge",
          state: "xyz",
        }),
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as { redirect: string };
      const redirect = new URL(body.redirect);
      expect(redirect.origin + redirect.pathname).toBe("https://client.test/cb");
      expect(redirect.searchParams.get("state")).toBe("xyz");
      const code = redirect.searchParams.get("code");
      expect(code).toBeTruthy();
      // The credential in the stored entry is CIPHERTEXT, never the key itself.
      const stored = JSON.parse(redis.store.get(`mcp:auth_code:${code}`) ?? "{}") as {
        encryptedApiKey: string;
        userId: string;
      };
      expect(stored.encryptedApiKey).toBe("enc(project-key)");
      expect(stored.userId).toBe("user-1");
    });
  });

  describe("when the redirect_uri is not one the client registered", () => {
    it("refuses LOCALLY rather than sending anything to a URI it never verified", async () => {
      const redis = fakeRedis({
        "mcp:oauth:client:client-1": JSON.stringify({
          redirectUris: ["https://client.test/cb"],
          clientName: "Editor",
        }),
      });
      const api = mount({ ports: { mcpAuthorize: mcpPorts(redis) } });

      const response = await api.fetch("/api/mcp/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          redirect_uri: "https://attacker.test/cb",
          client_id: "client-1",
          code_challenge: "challenge",
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe(
        "redirect_uri does not match any redirect URI registered for this client_id",
      );
      // Nothing is offered back to the unverified URI.
      expect(body.redirect).toBeUndefined();
    });
  });

  describe("when the project named is the globally-readable demo", () => {
    it("refuses BEFORE the permission probe, which would have passed for it", async () => {
      const redis = fakeRedis({
        "mcp:oauth:client:client-1": JSON.stringify({
          redirectUris: ["https://client.test/cb"],
          clientName: "Editor",
        }),
      });
      const probeProjectPermission = vi.fn(async () => true);
      const api = mount({
        ports: {
          mcpAuthorize: {
            ...mcpPorts(redis),
            isDemoProject: (projectId: string) => projectId === "project-demo",
            probeProjectPermission,
          },
        },
      });

      const response = await api.fetch("/api/mcp/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-demo",
          redirect_uri: "https://client.test/cb",
          client_id: "client-1",
          code_challenge: "challenge",
        }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: "access_denied" });
      expect(probeProjectPermission).not.toHaveBeenCalled();
    });
  });
});

describe("given the public image relay", () => {
  describe("when the caller sends no url", () => {
    it("refuses before any fetch is attempted", async () => {
      const api = mount({
        ports: { imageProxy: { blockLocalHttpCalls: true, allowedHosts: [] } },
      });

      const response = await api.fetch("/api/image-proxy");

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Missing url" });
    });
  });

  describe("when the url points at a private address", () => {
    it("answers one opaque failure rather than reporting the deployment's own network", async () => {
      const api = mount({
        ports: { imageProxy: { blockLocalHttpCalls: true, allowedHosts: [] } },
      });

      const response = await api.fetch("/api/image-proxy?url=http://127.0.0.1/secret.png");

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "Failed to fetch image" });
    });
  });
});

describe("given the operator ClickHouse EXPLAIN endpoint", () => {
  describe("when a caller presents the wrong bearer", () => {
    it("refuses without running anything", async () => {
      const explain = vi.fn();
      const api = mount({
        ports: {
          opsClickHouseExplain: {
            opsApiKey: () => "operator-secret",
            explain: () => ({ explain }) as never,
            isProduction: false,
          },
        },
      });

      const response = await api.fetch("/api/ops/clickhouse/explain", {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({ query: "SELECT 1" }),
      });

      expect(response.status).toBe(401);
      expect(explain).not.toHaveBeenCalled();
    });
  });

  describe("when this deployment provisioned no dedicated readonly account", () => {
    it("does not mount the endpoint at all, rather than leaving the regex filter alone on the door", () => {
      const api = mount({});

      expect(api.claims("/api/ops/clickhouse/explain")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function mount(options: {
  services?: ApiProcessRestServices;
  ports?: Partial<ApiProcessRestPorts>;
}) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: options.services ?? {},
    ports: {
      handlerManagedCredential: async () => ({
        ok: true,
        project,
        markUsed: () => {},
      }),
      rateLimit: async () => ({ allowed: true }),
      ...options.ports,
    } as ApiProcessRestPorts,
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
    claims: (path: string) => hono.routes.some((route) => route.path === path),
  };
}

/** Only the part of a stored step this suite reads back. */
type StoredDspyStep = { llmCalls: { cost?: number | undefined }[] };

function dspyPorts(input: {
  upsertDspyStep: (step: StoredDspyStep) => Promise<void>;
}): Partial<ApiProcessRestPorts> {
  return {
    dspySteps: {
      authenticateCredential: async () => ({ ok: true, project, markUsed: () => {} }),
      findOrCreate: () => ({ resolve: async () => ({ id: "experiment-1" }) }) as never,
      experiments: () => ({ upsertDspyStep: input.upsertDspyStep }) as never,
      listModelCosts: async () => [
        { model: "gpt-4o", regex: "gpt-4o", inputCostPerToken: 2e-6, outputCostPerToken: 4e-6 },
      ],
    },
  };
}

function dspyStep() {
  return {
    run_id: "run-1",
    experiment_slug: "my-run",
    index: "0",
    score: 0.5,
    label: "step",
    optimizer: { name: "MIPRO", parameters: {} },
    predictors: [],
    examples: [],
    llm_calls: [
      {
        __class__: "dsp.modules.gpt3.GPT3",
        response: {
          object: "chat.completion",
          model: "gpt-4o",
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      },
    ],
    timestamps: { created_at: 1_767_225_600_000 },
  };
}

function mcpPorts(redis: ReturnType<typeof fakeRedis>) {
  return {
    resolveSession: async () => ({ user: { id: "user-1" } }),
    tryGetProject: async (projectId: string) => ({
      id: projectId,
      apiKey: "project-key",
      archivedAt: null,
    }),
    probeProjectPermission: async () => true,
    isDemoProject: () => false,
    encrypt: (value: string) => `enc(${value})`,
    redis: redis as never,
  };
}

/** Just the two operations the approval step performs. */
function fakeRedis(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
  };
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: "organization-1" });
    c.set("apiKeyUserId", "user-1");
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
