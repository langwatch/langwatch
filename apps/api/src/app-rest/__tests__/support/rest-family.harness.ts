/**
 * One REST family, mounted the way this process mounts it, over services a
 * suite stands up itself.
 *
 * The management families — teams, organization, organization members,
 * organization provisioning, SCIM tokens, run plans, test suites and the
 * `/api/suites` alias — had no harness on this branch at all: their bindings
 * lived in the retired platform router's Postgres-backed suites. This module
 * is the one they share, so a family gets a suite by naming its services
 * rather than by describing the mount a fifth time.
 *
 * Three things are REAL here, and that is the point:
 *
 *   - the mount is `createApiProcessRestFeatures`, the same enumeration
 *     production composes, so a family that stops being mounted fails here;
 *   - the error rendering is `ApiRestObservabilityComposition`, this process's
 *     own, so a refusal is asserted at the wire a customer reads rather than
 *     at a shape the harness invented;
 *   - the families' own access declarations still run. What is faked is only
 *     the credential resolution — who the caller is — which is what lets one
 *     suite drive an organization-scoped route and a project-scoped one.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type ApiErrorBody,
} from "@langwatch/api/rest";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition";
import type {
  ApiPackagedRestAbsenceReport,
  ApiPackagedRestCollaborators,
  ApiPackagedRestFamilyName,
  ApiPackagedRestPorts,
  ApiPackagedRestServices,
} from "../../app-rest.packaged-families";
import {
  createApiProcessRestFeatures,
  type ApiProcessRestServices,
} from "../../app-rest.process-features";

/** The project every project-scoped route in these suites is called for. */
export const TEST_PROJECT = {
  id: "project-1",
  slug: "acme",
  teamId: "team-1",
  name: "Acme",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
} as const;

export const TEST_ORGANIZATION_ID = "organization-1";
export const TEST_TEAM_ID = "team-1";
export const TEST_USER_ID = "user-1";

/**
 * Who the credential chain resolved the caller as.
 *
 * A field left out keeps the default; `userId: null` is the distinct case of a
 * key that names no person, which is what decides whether a run records an
 * actor.
 */
export type RestFamilyCaller = {
  project?: Record<string, unknown> | undefined;
  organizationId?: string | undefined;
  userId?: string | null | undefined;
  /** A permission the caller does NOT hold; the route refuses before it reads. */
  deny?: (() => never) | undefined;
};

/**
 * Enforcement that authenticates every caller as one project, one
 * organization and one person.
 *
 * The declarations a family makes over these — `requires("scenarios:view")`,
 * the API-key ceiling, the route-level team and project checks — still run.
 * Only the resolution the process would have done against Postgres is stood in
 * for, so a suite drives the real access spine without a database.
 */
export function createRestFamilySecurity(caller: RestFamilyCaller = {}): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const deny = caller.deny;
  const guard: MiddlewareHandler = deny
    ? async () => {
        deny();
      }
    : pass;

  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", caller.project ?? TEST_PROJECT);
    if (caller.userId !== null) c.set("apiKeyUserId", caller.userId ?? TEST_USER_ID);
    await next();
  };
  const asOrganization: MiddlewareHandler = async (c, next) => {
    c.set("organization", { id: caller.organizationId ?? TEST_ORGANIZATION_ID });
    if (caller.userId !== null) c.set("apiKeyUserId", caller.userId ?? TEST_USER_ID);
    await next();
  };

  return createAppRestSecurity({
    ...ApiRestObservabilityComposition.create(),
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => guard,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => asOrganization,
    authorizeOrganizationPermission: () => guard,
    authorizeRouteTeamPermission: () => guard,
    authorizeRouteProjectPermission: () => guard,
    authenticateOrganizationThrowing: asOrganization,
    authorizeOrganizationPermissionThrowing: () => guard,
  } as never);
}

const noopMiddleware: MiddlewareHandler = async (_c, next) => {
  await next();
};

/**
 * Every packaged port, stood up open.
 *
 * Open rather than absent because a port left out takes a family off the mount
 * entirely, and a suite about a family's own refusals would then be driving
 * Hono's 404. What a suite is about, it overrides.
 */
export function packagedRestPorts(
  overrides: Partial<ApiPackagedRestPorts> = {},
): ApiPackagedRestPorts {
  return {
    agentPlatformUrl: () => "https://app.langwatch.test/acme/agents",
    platformUrl: ({ projectSlug, path }: { projectSlug: string; path: string }) =>
      `https://app.langwatch.test/${projectSlug}${path}`,
    scenarioRunPlatformUrl: () => "https://app.langwatch.test/acme/simulations",
    canonicalError: () => ({ status: 500, body: {} as ApiErrorBody }),
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
    extractInlineMedia: async ({ event }: { event: unknown }) => ({
      rewrittenEvent: event,
      refs: [],
    }),
    triggerWorkflowEvaluation: () => Promise.reject(new Error("no runner")),
    ...overrides,
  } as ApiPackagedRestPorts;
}

export type MountedRestFamily = {
  /** Drives one request through the mounted family, exactly as Hono serves it. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  put(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  delete(path: string, headers?: Record<string, string>): Promise<Response>;
  /** Whether ANY route is registered under this path. */
  claims(path: string): boolean;
  routes(): string[];
};

/**
 * Mounts whichever families the given services compose, and nothing else.
 *
 * `packaged` is the bag the feature-package families read; `services` reaches
 * the ones this process composes for itself (`organizationManagement` among
 * them). A suite names only what its family needs, so an absent service is a
 * family honestly not mounted rather than one answering 500.
 */
export function mountRestFamily(options: {
  packaged?: ApiPackagedRestServices | undefined;
  packagedPorts?: Partial<ApiPackagedRestPorts> | undefined;
  services?: Omit<ApiProcessRestServices, "packaged"> | undefined;
  /** Process-level ports a family reads instead of a service (`scim`, ...). */
  processPorts?: Record<string, unknown> | undefined;
  caller?: RestFamilyCaller | undefined;
  security?: AppRestSecurity | undefined;
  absence?: ApiPackagedRestAbsenceReport | undefined;
}): MountedRestFamily {
  const hono = new Hono();
  const packaged: ApiPackagedRestCollaborators | undefined = options.packaged
    ? { services: options.packaged, ports: packagedRestPorts(options.packagedPorts ?? {}) }
    : undefined;

  for (const app of createApiProcessRestFeatures({
    security: options.security ?? createRestFamilySecurity(options.caller ?? {}),
    services: {
      ...options.services,
      ...(packaged ? { packaged } : {}),
    } as ApiProcessRestServices,
    ports: {
      handlerManagedCredential: () => {
        throw new Error("These families authenticate through the framework chain.");
      },
      rateLimit: async () => ({ allowed: true }),
      publicBaseUrl: "https://app.langwatch.test",
      ...options.processPorts,
    } as never,
    ...(options.absence ? { packagedAbsence: options.absence } : {}),
  })) {
    hono.route("/", app);
  }

  const send = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return {
    fetch: (path, init) => hono.fetch(new Request(`http://api.test${path}`, init)),
    get: (path, headers) => send("GET", path, undefined, headers),
    post: (path, body, headers) => send("POST", path, body ?? {}, headers),
    patch: (path, body, headers) => send("PATCH", path, body ?? {}, headers),
    put: (path, body, headers) => send("PUT", path, body ?? {}, headers),
    delete: (path, headers) => send("DELETE", path, undefined, headers),
    claims: (path) =>
      hono.routes.some((route) => route.path === path || route.path.startsWith(`${path}/`)),
    routes: () => hono.routes.map((route) => route.path),
  };
}

/** A family name the mount left out, collected so a suite can name it. */
export function absenceRecorder(): {
  report: ApiPackagedRestAbsenceReport;
  absent: ApiPackagedRestFamilyName[];
} {
  const absent: ApiPackagedRestFamilyName[] = [];
  return {
    absent,
    report: { absent: (family) => absent.push(family) } as ApiPackagedRestAbsenceReport,
  };
}

/** The canonical error envelope's code, whichever body shape a family publishes. */
export async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as {
    code?: string;
    error?: string | { code?: string };
  };
  if (typeof body.code === "string") return body.code;
  if (typeof body.error === "string") return body.error;
  return body.error?.code;
}

/** Ignored by the families under test; kept so the signature stays honest. */
export type RestFamilyContext = Context;
