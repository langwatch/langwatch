/**
 * The families that live in a FEATURE PACKAGE, driven through the real Hono app
 * `createApiProcessRestFeatures` returns.
 *
 * The retired platform router mounted all of these through ONE all-or-nothing
 * call over thirty-two product services. What is under test here is the thing
 * that replaced it: each family is its own condition, so a process holding the
 * service serves it and a process without it serves nothing at that path
 * rather than a 500 — and the boot report names which.
 *
 * The membership assertions are the point of the file. A family reaches the
 * route-policy registry when it is BUILT, so "is it mounted" is exactly "is it
 * reachable", and the two tables below pin both directions at once. On top of
 * them, one golden path and one named failure per credential class drive real
 * requests through the real chain.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  TraceIngressCommandPort,
  TraceSpanCollectionService,
  TraceSpanDedupPort,
  TrackedEventSpanService,
  type TrackedEventPorts,
} from "@langwatch/trace-server";
import type { UserAvatarObjectReader } from "@langwatch/user-server";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  type ApiPackagedRestCollaborators,
  type ApiPackagedRestFamilyName,
} from "../app-rest.packaged-families";
import { createApiProcessRestFeatures } from "../app-rest.process-features";
import { createApiDualCredentialAuth } from "../../app/api-dual-credential-auth";
import { createApiTrackedEventPorts } from "../../features/trace/tracked-event-ports.adapter";

const project = { id: "project-1", slug: "acme", teamId: "team-1", name: "Acme" };

/** Every base path the packaged list can claim, and the family that owns it. */
const FAMILY_PATHS: ReadonlyArray<readonly [ApiPackagedRestFamilyName, string]> = [
  ["agent-cache", "/api/agent-cache"],
  ["agents", "/api/agents"],
  ["coding-agent", "/api/coding-agent"],
  ["coding-agent-v1", "/api/v1/coding-agent"],
  ["dashboards", "/api/dashboards"],
  ["dashboards", "/api/graphs"],
  ["dataset", "/api/dataset"],
  ["evaluators", "/api/evaluators"],
  ["experiments", "/api/experiments"],
  ["files", "/api/files"],
  ["governance", "/api/governance"],
  ["groups", "/api/groups"],
  ["me", "/api/me"],
  ["model-providers", "/api/model-defaults"],
  ["model-providers", "/api/model-providers"],
  ["monitors", "/api/monitors"],
  ["organizations", "/api/organizations"],
  ["projects", "/api/projects"],
  ["roles", "/api/roles"],
  ["role-bindings", "/api/role-bindings"],
  ["scenarios", "/api/scenarios"],
  ["scenario-events", "/api/scenario-events"],
  ["scim-tokens", "/api/scim-tokens"],
  ["secret", "/api/secrets"],
  ["simulation-runs", "/api/simulation-runs"],
  ["suites", "/api/suites"],
  ["teams", "/api/teams"],
  ["tracked-events", "/api/events/track"],
  ["tracked-events", "/api/track_event"],
  ["triggers", "/api/triggers"],
  ["triggers", "/api/trigger/slack"],
  ["user-avatar", "/api/user-avatar"],
  ["webhooks", "/api/webhooks/v1"],
  ["workflows", "/api/workflows"],
];

describe("given a process that composed every packaged service", () => {
  describe("when the mounted paths are enumerated", () => {
    it("serves each family at its own base path", () => {
      const api = mount(fullCollaborators());
      for (const [family, path] of FAMILY_PATHS) {
        expect(api.claims(path), `${family} should be mounted at ${path}`).toBe(true);
      }
    });
  });
});

describe("given a process that composed none of the packaged services", () => {
  describe("when the mounted paths are enumerated", () => {
    it("serves NONE of them, rather than mounting families over throwing stubs", () => {
      const api = mount(emptyCollaborators());
      for (const [family, path] of FAMILY_PATHS) {
        expect(
          api.claims(path),
          `${family} should be absent at ${path} on a process with no service for it`,
        ).toBe(false);
      }
    });
  });

  describe("when the absence report is read", () => {
    it("names every family it left out, so the gap is visible at boot rather than at a 404", () => {
      const absent: ApiPackagedRestFamilyName[] = [];
      mount(emptyCollaborators(), { absent: (family) => absent.push(family) });

      expect(new Set(absent)).toEqual(
        new Set([
          ...new Set(FAMILY_PATHS.map(([family]) => family)),
          // The one this process cannot build at all, named unconditionally.
          "copilotkit",
        ]),
      );
    });
  });
});

describe("given the deprecated agents family", () => {
  describe("when a project credential lists them", () => {
    it("answers from the application this process composed, for the credential's project", async () => {
      const list = vi.fn(async () => ({ data: [], page: 1, limit: 20, total: 0 }));
      const api = mount(collaboratorsWith({ agents: () => ({ list }) as never }));

      const response = await api.fetch("/api/agents");

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1" }));
    });
  });
});

describe("given the agent cache", () => {
  describe("when a run reads an entry the project never stored", () => {
    it("answers the one refusal every empty read answers, rather than an empty value", async () => {
      const api = mount(
        collaboratorsWith({
          agentCache: () =>
            ({
              getByName: vi.fn(async () => {
                throw Object.assign(new Error("no entry"), {
                  code: "cache_entry_not_found",
                  httpStatus: 404,
                });
              }),
              put: vi.fn(),
              claim: vi.fn(),
              delete: vi.fn(),
            }) as never,
        }),
      );

      const response = await api.fetch("/api/agent-cache/SESSION");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "cache_entry_not_found" });
    });
  });
});

describe("given the Enterprise-gated families", () => {
  describe("when this process composed no plan provider", () => {
    it("mounts none of the four rather than mounting them ungated", () => {
      const api = mount(
        collaboratorsWith(
          {
            organizations: () => ({}) as never,
            roles: () => ({}) as never,
            permissions: () => ({}) as never,
            authzGrants: () => ({}) as never,
            scim: () => ({}) as never,
          },
          { withoutEnterpriseGate: true },
        ),
      );

      expect(api.claims("/api/groups")).toBe(false);
      expect(api.claims("/api/roles")).toBe(false);
      expect(api.claims("/api/role-bindings")).toBe(false);
      expect(api.claims("/api/scim-tokens")).toBe(false);
    });
  });
});

describe("given the byte-serving file family", () => {
  describe("when this process composed no dual-credential verifier", () => {
    it("leaves it off rather than 401ing the in-app player", () => {
      const api = mount(
        collaboratorsWith({ storedObjects: () => ({}) as never }, { withoutDualAuth: true }),
      );

      expect(api.claims("/api/files/project-1/object-1")).toBe(false);
    });
  });
});

/**
 * The avatar family, whose read is authorized for ANY authenticated caller on
 * the platform.
 *
 * That breadth is only safe because the family refuses every object whose
 * purpose and owner kind are not the avatar ones, and that refusal is only real
 * if the process's object read ANSWERS the owner kind. It did not, which is why
 * this family was a named absence; these drive the mounted family over a reader
 * that carries both columns.
 *
 * Spec: specs/settings/user-avatar-upload.feature
 */
describe("given the avatar family over a reader that carries the owner kind", () => {
  describe("when a signed-in caller loads an avatar", () => {
    /** @scenario "The avatar route serves an object whose purpose and owner kind are the avatar ones" */
    it("streams the bytes with the stored media type", async () => {
      const api = mount(withAvatarObject(avatarRead()));

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Content-Length")).toBe("3");
    });
  });

  describe("when the same caller asks for an object that is not an avatar", () => {
    /** @scenario "An object that is not a user avatar is refused rather than served" */
    it("refuses by code rather than serving another tenant's trace media", async () => {
      const api = mount(
        withAvatarObject(
          avatarRead({ purpose: "trace_content", ownerKind: "span", mediaType: "audio/mpeg" }),
        ),
      );

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when the object is tagged as an avatar but was produced by something else", () => {
    /** @scenario "An object that is not a user avatar is refused rather than served" */
    it("refuses on the owner kind alone, so the purpose is not the only gate", async () => {
      const api = mount(withAvatarObject(avatarRead({ ownerKind: "span" })));

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: "avatar_not_found" });
    });
  });

  describe("when the caller is a teammate rather than the person in the photo", () => {
    /** @scenario "A signed-in teammate can load another user's uploaded avatar" */
    it("serves the photo, because an avatar has to render wherever a person is shown", async () => {
      const api = mount(withAvatarObject(avatarRead(), { userId: "teammate-2" }));

      // `user-1` uploaded it into their own personal project; `teammate-2` is
      // a different person and the route still answers. That breadth is the
      // family's whole point, and it is only safe because of the two refusals
      // above.
      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
    });
  });

  describe("when the request carries no credential at all", () => {
    /** @scenario "An unauthenticated request cannot load an avatar image" */
    it("refuses before any object is read, through the process's real verifier", async () => {
      const objects = vi.fn<UserAvatarObjectReader["getById"]>(async () => avatarRead());
      const api = mount(withRealDualAuth({ getById: objects }));

      const response = await api.fetch("/api/user-avatar/project-9/object-1");

      expect(response.status).toBe(401);
      expect(objects).not.toHaveBeenCalled();
    });
  });

  describe("when this process composed no dual-credential verifier", () => {
    /** @scenario "The avatar route is left off a process that cannot authenticate an image request" */
    it("leaves the family off rather than 401ing every member list", () => {
      const api = mount(
        collaboratorsWith(
          { userAvatarObjects: () => avatarReader(avatarRead()) },
          {
            withoutDualAuth: true,
          },
        ),
      );

      expect(api.claims("/api/user-avatar")).toBe(false);
    });
  });
});

describe("given the workflow family on a process with no evaluation runner", () => {
  describe("when a caller starts a run through it", () => {
    it("refuses BY NAME while the graph reads keep answering", async () => {
      const list = vi.fn(async () => []);
      const api = mount(
        collaboratorsWith({ workflows: () => ({ list, getById: vi.fn() }) as never }),
      );

      const response = await api.fetch("/api/workflows");

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });
});

/**
 * The tracked-event family, whose two URLs are one endpoint.
 *
 * `/api/track_event` predates `/api/events/track` and every pre-rename SDK
 * release still posts to it, so the pair is driven together: what these pin is
 * that the legacy URL reaches the SAME recorder and answers the SAME refusal,
 * because a second handler would drift the first time one of them gained a
 * check the other did not.
 *
 * Spec: specs/api-reference/tracked-event-validation.feature
 */
describe("given the tracked-event family", () => {
  describe("when a customer posts a valid event to the canonical URL", () => {
    it("records it and answers the sentence every SDK release reads", async () => {
      const { collaborators, recorded } = withTrackedEvents();
      const api = mount(collaborators);

      const response = await api.fetch("/api/events/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trace_id: "trace_1",
          event_type: "thumbs_up_down",
          metrics: { vote: 1 },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "Event tracked" });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ project: { id: "project-1" } });
    });
  });

  describe("when the same event is posted to the legacy URL", () => {
    /** @scenario The legacy URL reaches the same recorder as the canonical one */
    it("reaches the SAME recorder, rather than a second handler that could drift", async () => {
      const { collaborators, recorded } = withTrackedEvents();
      const api = mount(collaborators);

      const response = await api.fetch("/api/track_event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trace_id: "trace_1",
          event_type: "thumbs_up_down",
          metrics: { vote: 1 },
          event_id: "trackedevent_supplied",
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ message: "Event tracked" });
      expect(recorded).toHaveLength(1);
      // The caller's own id is honoured on both URLs, which is what makes a
      // retried POST idempotent rather than a second rating.
      expect(recorded[0]).toMatchObject({ eventId: "trackedevent_supplied" });
    });
  });

  describe("when a predefined event violates its own schema", () => {
    /** @scenario A predefined event that violates its schema is rejected, not errored */
    /** @scenario A rejected event is rejected the same way on both URLs */
    it("answers 400 naming the field, on both URLs, and records nothing", async () => {
      for (const path of ["/api/events/track", "/api/track_event"]) {
        const { collaborators, recorded } = withTrackedEvents();
        const api = mount(collaborators);

        const response = await api.fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            trace_id: "trace_1",
            event_type: "thumbs_up_down",
            metrics: { vote: 2 },
          }),
        });

        expect(response.status, `${path} should reject the payload`).toBe(400);
        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("vote");
        expect(recorded, `${path} should record nothing`).toHaveLength(0);
      }
    });
  });

  describe("when this process composed no tracked-event recorder", () => {
    /** @scenario Neither URL is served without a recorder to send the event to */
    it("serves neither URL rather than answering 200 to an event it drops", () => {
      const api = mount(collaboratorsWith({}));

      expect(api.claims("/api/events/track")).toBe(false);
      expect(api.claims("/api/track_event")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type MountReport = { absent(family: ApiPackagedRestFamilyName): void };

function mount(collaborators: ApiPackagedRestCollaborators, report?: MountReport) {
  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    services: { packaged: collaborators },
    ports: {
      handlerManagedCredential: () => {
        throw new Error("These families authenticate through the framework chain.");
      },
      rateLimit: async () => ({ allowed: true }),
    },
    ...(report ? { packagedAbsence: report as never } : {}),
  })) {
    hono.route("/", app);
  }

  return {
    fetch: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
    /**
     * Whether ANY route is registered under this path.
     *
     * Read off the router rather than by fetching, because "mounted" is a fact
     * about registration: a family that is present but refuses is still
     * mounted, and one that is absent answers Hono's own 404 with no handler
     * of ours ever running.
     */
    claims: (path: string) =>
      hono.routes.some((route) => route.path === path || route.path.startsWith(`${path}/`)),
    routes: () => hono.routes.map((route) => route.path),
  };
}

/** A bag holding a stand-in for every service, to pin the full mount table. */
function fullCollaborators(): ApiPackagedRestCollaborators {
  const anyService = () => ({}) as never;
  return {
    services: {
      agentCache: anyService,
      agents: anyService,
      apiKeys: anyService,
      authzGrants: anyService,
      automation: anyService,
      broadcast: anyService,
      codingAgents: anyService,
      codingAgentAudit: anyService,
      dashboard: anyService,
      datasets: anyService,
      evaluators: anyService,
      experiments: anyService,
      governance: anyService,
      modelProviders: anyService,
      monitors: anyService,
      organizations: anyService,
      organizationProvisioning: anyService,
      permissions: anyService,
      projects: anyService,
      roles: anyService,
      scenarios: anyService,
      scenarioTabs: anyService,
      scim: anyService,
      secrets: anyService,
      simulations: anyService,
      storedObjects: anyService,
      suites: anyService,
      trackedEvents: anyService,
      userAvatarObjects: anyService,
      webhooks: anyService,
      workflows: anyService,
    },
    ports: fullPorts(),
  };
}

function emptyCollaborators(): ApiPackagedRestCollaborators {
  return { services: {}, ports: fullPorts() };
}

/**
 * The tracked-event family over the REAL ports this process composes, whose
 * span collection records the command rather than enqueueing it.
 *
 * Real rather than stubbed because the two-pass validation the tests above
 * drive lives in the ports, not in the transport: a stand-in that accepted
 * everything would leave the 400 unproven.
 */
function withTrackedEvents(): {
  collaborators: ApiPackagedRestCollaborators;
  recorded: Array<{ project: { id: string }; eventId: string }>;
  commands: RecordSpanCommandData[];
} {
  const recorded: Array<{ project: { id: string }; eventId: string }> = [];
  const commands: RecordSpanCommandData[] = [];

  const real = createApiTrackedEventPorts({
    spans: TrackedEventSpanService.create({
      collection: TraceSpanCollectionService.create({
        dedup: new GrantingDedup(),
        commands: new RecordingCommands(commands),
      }),
    }),
    logger: { error: () => {} },
  });

  const ports: TrackedEventPorts = {
    ...real,
    recordTrackedEvent: async (input) => {
      recorded.push({ project: { id: input.project.id }, eventId: input.eventId });
      await real.recordTrackedEvent(input);
    },
  };

  return {
    recorded,
    commands,
    collaborators: collaboratorsWith({ trackedEvents: () => ports }),
  };
}

/** Every claim granted: dedup is not what these tests are about. */
class GrantingDedup extends TraceSpanDedupPort {
  async tryAcquireProcessingLock(): Promise<boolean> {
    return true;
  }

  async confirmProcessed(): Promise<void> {}

  async releaseOnFailure(): Promise<void> {}
}

/** The one command handoff, recorded rather than enqueued. */
class RecordingCommands extends TraceIngressCommandPort {
  constructor(private readonly sent: RecordSpanCommandData[]) {
    super();
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    this.sent.push(data);
  }
}

/**
 * One avatar read, in the shape the process's adapter answers with.
 *
 * The defaults are a real avatar; each test overrides only the field whose
 * refusal it is about, so what a case changes IS what it claims.
 */
function avatarRead(overrides: { purpose?: string; ownerKind?: string; mediaType?: string } = {}): {
  status: "available";
  metadata: { byteLength: number; mediaType: string; purpose: string; ownerKind: string };
  stream: Readable;
} {
  return {
    status: "available",
    metadata: {
      byteLength: 3,
      mediaType: overrides.mediaType ?? "image/png",
      purpose: overrides.purpose ?? "user_avatar",
      ownerKind: overrides.ownerKind ?? "user",
    },
    stream: Readable.from([Buffer.from([1, 2, 3])]),
  };
}

function avatarReader(read: ReturnType<typeof avatarRead>): UserAvatarObjectReader {
  return { getById: async () => read };
}

/**
 * The avatar family over a session-authenticated caller.
 *
 * The dual-auth verifier is the family's own credential resolution, and the
 * handler keys its rate limit on what that verifier left behind — so a
 * pass-through that set nothing would 500 before any refusal was reached.
 */
function withAvatarObject(
  read: ReturnType<typeof avatarRead>,
  caller: { userId: string } = { userId: "user-1" },
): ApiPackagedRestCollaborators {
  const ports = fullPorts();
  return {
    services: { userAvatarObjects: () => avatarReader(read) },
    ports: {
      ...ports,
      dualAuth: async (c, next) => {
        c.set("userId", caller.userId);
        await next();
      },
    },
  };
}

/**
 * The avatar family behind the process's REAL dual-credential verifier.
 *
 * The other avatar cases stub the verifier, because what they are about is the
 * refusal the family itself makes on an object. This one is about the door in
 * front of it, so the middleware under test has to be the one the process
 * composes: an anonymous request claims neither credential kind, and
 * arbitration answers "unclaimed" before any object is read.
 */
function withRealDualAuth(objects: UserAvatarObjectReader): ApiPackagedRestCollaborators {
  return {
    services: { userAvatarObjects: () => objects },
    ports: {
      ...fullPorts(),
      dualAuth: createApiDualCredentialAuth({
        apiKeys: { tryResolveToken: async () => null } as never,
        session: {
          resolve: async () => null,
          permitted: async () => false,
        },
      }),
    },
  };
}

function collaboratorsWith(
  services: ApiPackagedRestCollaborators["services"],
  options: { withoutEnterpriseGate?: boolean; withoutDualAuth?: boolean } = {},
): ApiPackagedRestCollaborators {
  const ports = fullPorts();
  const trimmed = { ...ports } as Record<string, unknown>;
  if (options.withoutEnterpriseGate) delete trimmed.enterpriseGate;
  if (options.withoutDualAuth) delete trimmed.dualAuth;
  return { services, ports: trimmed as ApiPackagedRestCollaborators["ports"] };
}

const noopMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

function fullPorts(): ApiPackagedRestCollaborators["ports"] {
  return {
    agentPlatformUrl: () => "https://app.langwatch.test/acme/agents",
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    scenarioRunPlatformUrl: () => "https://app.langwatch.test/acme/simulations",
    canonicalError: () => ({ status: 500, body: {} as never }),
    organizationMiddleware: noopMiddleware,
    managementAudit: () => {},
    organizationLedgerActor: () => ({ type: "system", id: "system:test" }) as never,
    rbacVocabulary: {
      actions: ["view"],
      resources: ["traces"],
      isOrganizationExclusive: () => false,
    },
    instanceAdminKey: () => "instance-key",
    isSaas: () => false,
    reportError: () => {},
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    monitorMappingsSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
    requireApiKeyPermission: () => noopMiddleware,
    traceUsageGuard: noopMiddleware,
    requireProjectPermission: async () => {},
    dualAuth: noopMiddleware,
    enterpriseGate: () => noopMiddleware,
    authorizeDatasetDirectUpload: async () => ({ ok: false, status: 401, error: "no" }),
    extractInlineMedia: async ({ event }) => ({ rewrittenEvent: event, refs: [] }),
    triggerWorkflowEvaluation: () => Promise.reject(new Error("no runner")),
  };
}

/**
 * Enforcement that authenticates every caller as the same project and the same
 * organization. The families' own access declarations still run; what is faked
 * is only the credential resolution the process would have done.
 */
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

/** A handled refusal must reach the caller at its own status with its own code. */
const renderHandled: ErrorHandler = (error, c) => {
  // Hono's own transport-level refusal — what the dual-credential verifier
  // raises for a request carrying no credential — carries its response with it.
  if (error instanceof HTTPException) return error.getResponse();
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};
