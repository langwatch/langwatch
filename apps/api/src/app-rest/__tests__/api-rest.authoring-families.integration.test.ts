/**
 * The four AUTHORING doors this process composes, driven through the real Hono
 * app `createApiProcessRestFeatures` returns.
 *
 * One file for four families because the thing under test is the same in all
 * four: each is `handlerManagedAuth({ credential: "session" })`, so the wire it
 * publishes for a signed-out caller and for one without the permission is the
 * family's own and must survive the move, and each dispatches a model through
 * a port this process fills rather than resolving one for itself.
 *
 * Each family gets its golden path and one named failure, and the failures are
 * the ones a customer would otherwise read as an answer: an editor that
 * silently returns nothing, a playground that streams from a provider the
 * project switched off, a generator that runs forever behind a proxy timeout.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { WorkflowApp } from "@langwatch/workflow-server";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../app-rest.process-features";
import type { ApiAuthoringRestComposition } from "../../app/api-authoring-rest.composition";
import type { ApiHandlerManagedSessionPort } from "../../app/api-handler-managed-session";

describe("given the Studio's run dispatch door", () => {
  describe("when a permitted person posts a runnable event", () => {
    it("prepares the event through the workflow application and streams the engine's events", async () => {
      const postEvent = vi.fn(async (input: { onEvent: (event: { type: string }) => void }) => {
        input.onEvent({ type: "done" } as never);
      });
      const prepareStudioEvent = vi.fn(async (input: { event: unknown }) => input.event);
      const api = mount({ workflowStudio: { postEvent, prepareStudioEvent } });

      const response = await api.fetch("/api/workflows/post_event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", event: { type: "is_alive", payload: {} } }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      await expect(response.text()).resolves.toContain('"done"');
      expect(prepareStudioEvent).toHaveBeenCalledWith({
        projectId: "project-1",
        event: { type: "is_alive", payload: {} },
      });
    });
  });

  describe("when the event asks for an optimization run", () => {
    it("refuses at 410 by name, without reaching the engine", async () => {
      const postEvent = vi.fn(async () => {});
      const api = mount({ workflowStudio: { postEvent } });

      const response = await api.fetch("/api/workflows/post_event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          event: {
            type: "execute_optimization",
            payload: {
              run_id: "run_1",
              workflow_version_id: "version_1",
              optimizer: "MIPROv2",
              params: {},
              workflow: minimalStudioWorkflow(),
            },
          },
        }),
      });

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({ type: "optimize_disabled" });
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the person may not manage workflows", () => {
    it("refuses at 403 before the workflow application is read", async () => {
      const prepareStudioEvent = vi.fn();
      const api = mount({ permitted: false, workflowStudio: { prepareStudioEvent } });

      const response = await api.fetch("/api/workflows/post_event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", event: { type: "is_alive", payload: {} } }),
      });

      expect(response.status).toBe(403);
      expect(prepareStudioEvent).not.toHaveBeenCalled();
    });
  });
});

describe("given the Studio's code completion door", () => {
  describe("when the request names no project", () => {
    it("refuses at 400 without resolving a model", async () => {
      const resolveModel = vi.fn();
      const api = mount({ resolveModel });

      const response = await api.fetch("/api/workflows/code-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ completionMetadata: {} }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Project ID is required." });
      expect(resolveModel).not.toHaveBeenCalled();
    });
  });

  describe("when nobody is signed in", () => {
    it("refuses at 401 with the family's own body", async () => {
      const api = mount({ session: null });

      const response = await api.fetch("/api/workflows/code-completion?projectId=project-1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "You must be logged in to access this endpoint.",
      });
    });
  });
});

describe("given the dataset row generator", () => {
  describe("when a permitted person generates against a project", () => {
    it("resolves the generator's own feature key on this deployment", async () => {
      const resolveModel = vi.fn(async () => stubModel());
      const api = mount({ resolveModel });

      const response = await api.fetch("/api/dataset/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", dataset: "id,input\n", messages: [] }),
      });

      expect(response.status).toBe(200);
      expect(resolveModel).toHaveBeenCalledWith({
        projectId: "project-1",
        featureKey: "datasets.generator",
      });
    });
  });

  describe("when the request carries no project", () => {
    it("refuses at 400 without resolving a model", async () => {
      const resolveModel = vi.fn();
      const api = mount({ resolveModel });

      const response = await api.fetch("/api/dataset/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset: "", messages: [] }),
      });

      expect(response.status).toBe(400);
      expect(resolveModel).not.toHaveBeenCalled();
    });
  });
});

describe("given the scenario author-assist", () => {
  describe("when the body is not a scenario request", () => {
    it("refuses at 400 before the permission probe is run", async () => {
      const permitted = vi.fn(async () => true);
      const api = mount({ permittedProbe: permitted });

      const response = await api.fetch("/api/scenario/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Invalid request body" });
      expect(permitted).not.toHaveBeenCalled();
    });
  });

  describe("when the generation runs past this deployment's cap", () => {
    it("answers a fast 504 envelope rather than leaving the request open", async () => {
      const api = mount({
        scenarioTimeoutMs: 1,
        resolveModel: async () => neverAnsweringModel(),
      });

      const response = await api.fetch("/api/scenario/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "an angry customer",
          currentScenario: null,
          projectId: "project-1",
        }),
      });

      expect(response.status).toBe(504);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("took too long"),
      });
    });
  });
});

describe("given the model playground", () => {
  describe("when the caller names a provider the project switched off", () => {
    it("says the provider is disabled rather than streaming from another", async () => {
      const prepareExecution = vi.fn();
      const api = mount({
        modelProviders: {
          getExecutionProviders: async () => ({
            openai: disabledProviderRow(),
          }),
          prepareExecution,
        },
      });

      const response = await api.fetch("/api/playground", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-project-id": "project-1",
          "x-model": "openai/gpt-5-mini",
        },
        body: JSON.stringify({ messages: [] }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Provider openai is disabled, go to settings to enable it",
      });
      expect(prepareExecution).not.toHaveBeenCalled();
    });
  });

  describe("when the request carries no model header", () => {
    it("refuses at 400 without reading the project's providers", async () => {
      const getExecutionProviders = vi.fn();
      const api = mount({ modelProviders: { getExecutionProviders } });

      const response = await api.fetch("/api/playground", {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-id": "project-1" },
        body: JSON.stringify({ messages: [] }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "Missing model header" });
      expect(getExecutionProviders).not.toHaveBeenCalled();
    });
  });
});

describe("given a process that composed no browser-session transport", () => {
  it("serves none of the four authoring doors rather than four that refuse everybody", async () => {
    const api = mountWithout();

    for (const path of [
      "/api/workflows/post_event",
      "/api/workflows/code-completion",
      "/api/dataset/generate",
      "/api/scenario/generate",
      "/api/playground",
    ]) {
      const response = await api.fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------

type MountOptions = {
  session?: { user: { id: string } } | null;
  permitted?: boolean;
  permittedProbe?: (input: never) => Promise<boolean>;
  resolveModel?: (input: { projectId: string; featureKey: string }) => Promise<unknown>;
  scenarioTimeoutMs?: number;
  workflowStudio?: {
    postEvent?: (input: never) => Promise<void>;
    prepareStudioEvent?: (input: never) => Promise<unknown>;
  };
  modelProviders?: Partial<{
    getExecutionProviders: (input: never) => Promise<unknown>;
    prepareExecution: (input: never) => Promise<unknown>;
  }>;
};

function mount(options: MountOptions = {}) {
  const session: ApiHandlerManagedSessionPort = {
    resolve: async () =>
      options.session === undefined ? { user: { id: "user-1" } } : options.session,
    permitted: options.permittedProbe
      ? (options.permittedProbe as ApiHandlerManagedSessionPort["permitted"])
      : async () => options.permitted ?? true,
  };
  const resolveModel = (options.resolveModel ??
    (async () => stubModel())) as ApiAuthoringRestComposition["datasetGenerate"] extends undefined
    ? never
    : never;

  const authoring = {
    workflowStudio: {
      session,
      resolveModel: options.resolveModel ?? (async () => stubModel()),
      workflows: () =>
        ({
          prepareStudioEvent:
            options.workflowStudio?.prepareStudioEvent ??
            (async (input: { event: unknown }) => input.event),
        }) as unknown as WorkflowApp,
      postEvent: options.workflowStudio?.postEvent ?? (async () => {}),
    },
    playground: {
      session,
      modelProviders: () =>
        ({
          getExecutionProviders: async () => ({}),
          prepareExecution: async () => ({ api_key: "k", model: "m" }),
          ...options.modelProviders,
        }) as unknown as ModelProviderService,
      executionProxyBaseUrl: "http://nlp.test/go/proxy/v1",
    },
    datasetGenerate: { session, resolveModel: options.resolveModel ?? (async () => stubModel()) },
    scenarioGenerate: { session, resolveModel: options.resolveModel ?? (async () => stubModel()) },
  } as unknown as ApiAuthoringRestComposition;
  void resolveModel;

  return build({
    authoring,
    ...(options.scenarioTimeoutMs === undefined
      ? {}
      : { scenarioTimeoutMs: options.scenarioTimeoutMs }),
  });
}

function mountWithout() {
  return build({});
}

function build(input: { authoring?: ApiAuthoringRestComposition; scenarioTimeoutMs?: number }) {
  if (input.scenarioTimeoutMs !== undefined) {
    process.env.SCENARIO_GENERATE_TIMEOUT_MS = String(input.scenarioTimeoutMs);
  } else {
    delete process.env.SCENARIO_GENERATE_TIMEOUT_MS;
  }
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: { ...(input.authoring ? { authoring: input.authoring } : {}) },
    ports: {
      handlerManagedCredential: () => {
        throw new Error("These families resolve a session, never a project credential.");
      },
      rateLimit: async () => ({ allowed: true }),
    },
  })) {
    hono.route("/", app);
  }
  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

/** One provider row the project has switched off. */
function disabledProviderRow() {
  return {
    id: "mp_1",
    organizationId: "organization-1",
    provider: "openai",
    name: "OpenAI",
    enabled: false,
    routingHandle: null,
    scopes: [],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: null,
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    deploymentMapping: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    models: null,
    embeddingsModels: null,
    isSystem: false,
    embeddingsUnsupported: false,
  };
}

/** The smallest graph the studio event contract will accept. */
function minimalStudioWorkflow() {
  return {
    spec_version: "1.5",
    workflow_id: "workflow_1",
    name: "A workflow",
    icon: "🧩",
    description: "",
    version: "1.0",
    state: {},
    nodes: [],
    edges: [],
  };
}

/** A model handle that never has to answer, for the paths that stop first. */
function stubModel(): never {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test",
    doGenerate: async () => {
      throw new Error("not reached");
    },
    doStream: async () => {
      throw new Error("not reached");
    },
  } as never;
}

/** A model handle that never resolves, so only the abort cap can end the call. */
function neverAnsweringModel(): never {
  return {
    specificationVersion: "v2",
    provider: "test",
    modelId: "test",
    doGenerate: (options: { abortSignal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.abortSignal?.addEventListener("abort", () =>
          reject(options.abortSignal?.reason ?? new Error("aborted")),
        );
      }),
    doStream: async () => {
      throw new Error("not reached");
    },
  } as never;
}

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
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
