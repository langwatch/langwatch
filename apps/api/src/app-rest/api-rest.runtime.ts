/**
 * The ONE REST runtime this process serves every declared family through: the
 * doors it opens, the identity each resolves, and the stores a declared
 * capability counts and caches in. A family never builds a runtime of its own.
 */
import type { Actor } from "@langwatch/actor";
import type { RateLimiter, ResponseCache } from "@langwatch/api";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type MountableRestApp,
  type RestCaller,
  type RestDoorCredential,
  type RestErrorHandler,
  type RestRuntime,
  type RestTransportDeclaration,
  type RestTransportMiddlewareBinding,
} from "@langwatch/api/rest";
import type {
  ResolvedApiKeyCredential,
  ResolvedOrganizationApiKeyToken,
} from "@langwatch/api-key-contract";
import type { AuthzPermission, PermissionDecision } from "@langwatch/authz-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiDualAuthVariables } from "../app/api-dual-credential-auth.ts";

/**
 * The project credential a family resolves through. The resolved token travels
 * with the answer because a family that asks a SECOND permission question of
 * its caller — costs, say — asks it of the credential, not of whoever holds it.
 */
export type ApiHandlerManagedCredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<
  | Readonly<{
      ok: true;
      project: Readonly<{ id: string }>;
      resolved: ResolvedApiKeyCredential;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>
>;

/**
 * The organization credential a family resolves through. The resolved token
 * travels with the answer because the api-keys family asks a SECOND question
 * of the KEY as well as of the member holding it.
 */
export type ApiOrganizationCredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<
  | Readonly<{
      ok: true;
      resolved: ResolvedOrganizationApiKeyToken;
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>
>;

/**
 * The same organization credential, resolved and asked nothing: a route that
 * answers any authenticated caller has no permission for the door to ask.
 */
export type ApiOrganizationIdentityPort = (input: {
  request: Request;
}) => Promise<
  | Readonly<{ ok: true; resolved: ResolvedOrganizationApiKeyToken; markUsed: () => void }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>
>;

/**
 * Whether the organization credential in hand holds one permission at the
 * PROJECT a route's own path named — the second question a family whose door
 * is one tier wider than its resources asks.
 */
export type ApiRestRouteAuthorizationPort = (input: {
  credential: ResolvedOrganizationApiKeyToken;
  permission: AuthzPermission;
  projectId: string;
}) => Promise<PermissionDecision>;

/**
 * The directory bearer an identity provider presents on `/api/scim/v2`. It
 * names a TENANT and nobody inside it, which is why the answer is the
 * organization it may provision rather than a person.
 */
export type ApiScimDirectoryCredentialPort = (input: {
  request: Request;
}) => Promise<Readonly<{ organizationId: string }>>;

/** Every door a REST declaration may name, opened by this process or not. */
export type ApiRestDoor = RestDoorCredential | "public";

/**
 * Which doors this process opens. The two it does not are named rather than
 * omitted: a declaration reaching for one is refused at MOUNT, by door name,
 * instead of reaching a request that resolves nobody.
 */
const OPENED_DOORS = {
  projectKey: true,
  session: true,
  public: true,
  organizationKey: true,
  scimToken: true,
  internalSecret: false,
  instanceAdminKey: false,
} as const satisfies Record<ApiRestDoor, boolean>;

/** The doors above that this process actually opens. */
type OpenApiRestDoor = {
  [Door in ApiRestDoor]: (typeof OPENED_DOORS)[Door] extends true ? Door : never;
}[ApiRestDoor];

/** What the byte door's verifier left on a request it let through. */
export type ApiRestBrowserCaller = Readonly<{
  apiKeyProjectId?: string | undefined;
  userId?: string | undefined;
  apiKeyCeiling?: ((permission: AuthzPermission) => Promise<void>) | undefined;
}>;

/** What the runtime needs from the process to open its doors. */
export type ApiRestRuntimePorts = Readonly<{
  /** Resolves a project API key and enforces one permission as a key ceiling. */
  projectCredential: ApiHandlerManagedCredentialPort;
  /**
   * Resolves an organization API key and enforces one permission at
   * organization scope.
   */
  organizationCredential: ApiOrganizationCredentialPort;
  /** Resolves the same credential with no permission asked of it. */
  organizationIdentity: ApiOrganizationIdentityPort;
  /** Answers the permission a route asks at the project its own path names. */
  routeAuthorization: ApiRestRouteAuthorizationPort;
  /** The envelope a family answers a refusal in unless it names its own. */
  errors: RestErrorHandler;
  /**
   * Accepts a project API key OR a browser session and refuses a request
   * carrying both. Absent, this process opens no session door and says so at
   * the mount of the first family that names one.
   */
  dualCredential?: MiddlewareHandler | undefined;
  /**
   * Verifies the bearer an identity provider provisions with. Absent, this
   * process opens no SCIM door and says so at the mount of the first family
   * that names one.
   */
  directoryCredential?: ApiScimDirectoryCredentialPort | undefined;
  /** The counter behind every route that declared how often one caller may ask. */
  rateLimiter?: RateLimiter | undefined;
  /** The store behind every route that declared how long its answer stands. */
  cache?: ResponseCache | undefined;
}>;

/** What one family states beyond its declaration and its application. */
export type ApiRestMountOptions = Readonly<{
  /** The bodies this family must keep answering; the process envelope otherwise. */
  onError?: RestErrorHandler | undefined;
  /** One binding per fact the declaration's own routes name. */
  facts?: readonly RestTransportMiddlewareBinding[] | undefined;
  /** Applied under the family's paths before any route. */
  middleware?: readonly MiddlewareHandler[] | undefined;
}>;

/** The process's REST boundary: one door table, one mount. */
export interface ApiRestRuntime {
  /** Opens one declared family on the door its own declaration names. */
  mount<Api>(
    declaration: RestTransportDeclaration<Api>,
    app: () => Api,
    options?: ApiRestMountOptions,
  ): MountableRestApp;
  /** What the project door resolved for the request in hand. */
  projectCredentialOf(request: Request): ResolvedApiKeyCredential;
  /** What the organization door resolved for the request in hand. */
  organizationCredentialOf(request: Request): ResolvedOrganizationApiKeyToken;
  /** What the byte door's verifier left on the request in hand. */
  browserCallerOf(request: Request): ApiRestBrowserCaller;
}

/**
 * A credential the door would not accept, carrying the status and the body the
 * credential chain itself wrote. ONE class for every family: the refusal is the
 * DOOR's answer, and nine families rendering their own was nine copies of it.
 */
export class ApiRestCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("REST request refused at the door");
    this.name = "ApiRestCredentialRefusal";
  }
}

/** Builds this process's door table, once. */
export function createApiRestRuntime(ports: ApiRestRuntimePorts): ApiRestRuntime {
  const resolved = new WeakMap<Request, ResolvedApiKeyCredential>();
  const organizations = new WeakMap<Request, ResolvedOrganizationApiKeyToken>();
  // Keyed on the CALLER the door answered with, because `identity.authorize` is
  // handed that answer and not the request it came from.
  const callerCredentials = new WeakMap<RestCaller, ResolvedOrganizationApiKeyToken>();
  const browserCallers = new WeakMap<Request, ApiRestBrowserCaller>();
  const stores = {
    ...(ports.rateLimiter ? { rateLimiter: ports.rateLimiter } : {}),
    ...(ports.cache ? { cache: ports.cache } : {}),
  };

  const openDoors: Record<OpenApiRestDoor, RestRuntime> = {
    // Every project-scoped family: the key is resolved once, its refusal is
    // rendered once, and its facts are bound once.
    projectKey: createRestRuntime({
      identity: {
        authenticate: async ({ request, permission }): Promise<RestCaller> => {
          const credential = await ports.projectCredential({ request, permission });
          if (!credential.ok) {
            throw new ApiRestCredentialRefusal(credential.status, credential.body);
          }
          resolved.set(request, credential.resolved);

          return {
            actor: actorOf(credential.resolved),
            scope: { tier: "project", id: credential.project.id },
            markUsed: credential.markUsed,
          };
        },
      },
      ...stores,
    }),
    // Every organization-scoped family: the key is resolved once, its refusal
    // is rendered once, and the credential a second question is asked about is
    // kept against the request the declaration is handed.
    organizationKey: createRestRuntime({
      identity: {
        // The permission is asked of the credential at the ORGANIZATION, the
        // only scope this door resolves. A route that names its own scope asks
        // a SECOND question through `authorize` below rather than replacing
        // this one, so such a route is the stricter of the two.
        authenticate: async ({ request, permission }): Promise<RestCaller> =>
          organizationCaller(
            { organizations, callerCredentials },
            request,
            await ports.organizationCredential({ request, permission }),
          ),
        identify: async ({ request }): Promise<RestCaller> =>
          organizationCaller(
            { organizations, callerCredentials },
            request,
            await ports.organizationIdentity({ request }),
          ),
        authorize: ({ caller, permission, target }) => {
          if (target.tier !== "project") {
            throw new Error(
              `The organization door answers a route-scoped permission at a project, and ` +
                `"${permission}" was asked at a ${target.tier}`,
            );
          }

          return ports.routeAuthorization({
            credential: credentialBehind(callerCredentials, caller),
            permission,
            projectId: target.id,
          });
        },
      },
      ...stores,
    }),
    // The SCIM 2.0 provisioning door. No permission is asked of the bearer:
    // holding it IS the authority, so the twelve gated routes identify rather
    // than authenticate, and the three discovery routes resolve nothing.
    scimToken: createRestRuntime({
      identity: {
        authenticate: () => {
          throw new Error("The SCIM door asks no permission of the bearer it was opened on.");
        },
        identify: async ({ request }): Promise<RestCaller> => {
          const directory = await directoryOf(ports)({ request });

          return {
            // A directory bearer stands for its tenant and for nobody inside
            // it, so the credential IS the organization it provisions.
            actor: { type: "api_key", id: directory.organizationId },
            scope: { tier: "organization", id: directory.organizationId },
          };
        },
      },
      ...stores,
    }),
    // The byte doors a page and a key both reach: the verifier below has
    // already decided, so this reads its answer rather than asking again.
    session: createRestRuntime({
      identity: {
        authenticate: () => {
          throw new Error("The byte door asks no permission of the credential it was opened on.");
        },
        identify: ({ request }) => {
          const userId = browserCallers.get(request)?.userId;

          return { actor: userId ? { type: "user", id: userId } : null, scope: null };
        },
      },
      ...stores,
    }),
    // Every family whose routes are all public: nothing is resolved, and the
    // handler is told so rather than handed a guess.
    public: createRestRuntime({
      identity: {
        authenticate: () => {
          throw new Error("A public REST route answers with no credential resolved.");
        },
      },
      ...stores,
    }),
  };
  const verifier = ports.dualCredential
    ? [ports.dualCredential, remember(browserCallers)]
    : null;

  return {
    projectCredentialOf: (request) => projectCredentialOf(resolved, request),
    organizationCredentialOf: (request) => organizationCredentialOf(organizations, request),
    browserCallerOf: (request) => browserCallers.get(request) ?? {},
    mount: (declaration, app, options = {}) => {
      const door = openDoorFor(declaration, {
        verified: verifier !== null,
        directory: ports.directoryCredential !== undefined,
      });

      return openDoors[door].mount(declaration, {
        app,
        onError: renderRefusal(options.onError ?? ports.errors),
        ...mountMiddleware({ door, verifier, options }),
        facts: [
          ...(door === "projectKey" ? [projectFacts(resolved)] : []),
          ...(options.facts ?? []),
        ],
      });
    },
  };
}

/**
 * The door a declaration names, refused here by name when this process does not
 * open it — at MOUNT, rather than at the first request that resolves nobody.
 */
function openDoorFor<Api>(
  declaration: RestTransportDeclaration<Api>,
  opened: Readonly<{ verified: boolean; directory: boolean }>,
): OpenApiRestDoor {
  const door = doorOf(declaration);

  if (!isOpen(door)) {
    throw new Error(
      `REST "${declaration.namespace}" answers behind the "${door}" door, and this process ` +
        "opens no such door",
    );
  }

  if (door === "session" && !opened.verified) {
    throw new Error(
      `REST "${declaration.namespace}" answers behind a browser session, and this process ` +
        "composed no dual-credential verifier to open one with",
    );
  }

  if (door === "scimToken" && !opened.directory) {
    throw new Error(
      `REST "${declaration.namespace}" answers behind a directory bearer, and this process ` +
        "composed no SCIM application to verify one with",
    );
  }

  return door;
}

/** The directory verifier, or the wiring bug that this door was opened without one. */
function directoryOf(ports: ApiRestRuntimePorts): ApiScimDirectoryCredentialPort {
  const directory = ports.directoryCredential;
  if (!directory) throw new Error("The SCIM door was opened with no directory verifier");

  return directory;
}

/**
 * What runs under the family's paths before any route: the byte door's verifier
 * first, where the family answers behind one, then the family's own.
 */
function mountMiddleware({
  door,
  verifier,
  options,
}: {
  door: OpenApiRestDoor;
  verifier: readonly MiddlewareHandler[] | null;
  options: ApiRestMountOptions;
}): { middleware?: readonly MiddlewareHandler[] } {
  const own = options.middleware ?? [];
  const middleware = door === "session" && verifier ? [...verifier, ...own] : own;

  return middleware.length > 0 ? { middleware } : {};
}

/** Whether this process opens the door a declaration named. */
function isOpen(door: ApiRestDoor): door is OpenApiRestDoor {
  return OPENED_DOORS[door];
}

/**
 * The door a family answers behind, read off its DECLARATION. A family whose
 * every route is public resolves nothing at all, whatever credential the
 * declaration nominally carries.
 */
function doorOf<Api>(declaration: RestTransportDeclaration<Api>): ApiRestDoor {
  return declaration.routes.every((route) => route.access?.kind === "public")
    ? "public"
    : declaration.credential;
}

/**
 * What the organization door answers with, and the two places the credential
 * behind it is kept: against the REQUEST, for the facts a family binds, and
 * against the CALLER, for the second permission a route asks at its project.
 */
function organizationCaller(
  kept: Readonly<{
    organizations: WeakMap<Request, ResolvedOrganizationApiKeyToken>;
    callerCredentials: WeakMap<RestCaller, ResolvedOrganizationApiKeyToken>;
  }>,
  request: Request,
  credential:
    | Readonly<{ ok: true; resolved: ResolvedOrganizationApiKeyToken; markUsed: () => void }>
    | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>,
): RestCaller {
  if (!credential.ok) throw new ApiRestCredentialRefusal(credential.status, credential.body);

  kept.organizations.set(request, credential.resolved);

  const caller: RestCaller = {
    actor: credential.resolved.userId ? { type: "user", id: credential.resolved.userId } : null,
    scope: { tier: "organization", id: credential.resolved.organizationId },
    markUsed: credential.markUsed,
  };

  kept.callerCredentials.set(caller, credential.resolved);

  return caller;
}

/** The credential this door answered with, or the wiring bug that it did not. */
function credentialBehind(
  callerCredentials: WeakMap<RestCaller, ResolvedOrganizationApiKeyToken>,
  caller: RestCaller,
): ResolvedOrganizationApiKeyToken {
  const credential = callerCredentials.get(caller);
  if (!credential) throw new Error("The organization door authorized a caller it did not resolve");

  return credential;
}

/** The credential the project door resolved, or the wiring bug that it did not. */
function projectCredentialOf(
  resolved: WeakMap<Request, ResolvedApiKeyCredential>,
  request: Request,
): ResolvedApiKeyCredential {
  const credential = resolved.get(request);
  if (!credential) throw new Error("The project door resolved no credential for this request");

  return credential;
}

/** The credential the organization door resolved, or the wiring bug that it did not. */
function organizationCredentialOf(
  organizations: WeakMap<Request, ResolvedOrganizationApiKeyToken>,
  request: Request,
): ResolvedOrganizationApiKeyToken {
  const credential = organizations.get(request);
  if (!credential) {
    throw new Error("The organization door resolved no credential for this request");
  }

  return credential;
}

/**
 * What a project-scoped door knows about its caller beyond the request: bound
 * once, here, so a family that declares the fact binds nothing for it.
 */
function projectFacts(
  resolved: WeakMap<Request, ResolvedApiKeyCredential>,
): RestTransportMiddlewareBinding {
  return bindRestMiddleware(projectRestFacts, (context) => {
    const credential = projectCredentialOf(resolved, context.req.raw);

    return {
      projectSlug: credential.project.slug,
      viewerUserId: credential.type === "apiKey" ? credential.userId : null,
      actorId: actorIdOf(credential),
    };
  });
}

/** Keeps the verifier's answer against the request the declaration is handed. */
function remember(
  callers: WeakMap<Request, ApiRestBrowserCaller>,
): MiddlewareHandler<{ Variables: ApiDualAuthVariables }> {
  return async (context, next) => {
    callers.set(context.req.raw, {
      apiKeyProjectId: context.get("apiKeyProjectId"),
      userId: context.get("userId"),
      apiKeyCeiling: context.get("apiKeyCeiling"),
    });

    await next();
  };
}

/** The door's own refusal keeps its body; everything else is the family's. */
function renderRefusal(boundary: RestErrorHandler): RestErrorHandler {
  return (error, context) => {
    if (error instanceof ApiRestCredentialRefusal) return context.json(error.body, error.status);

    return boundary(error, context);
  };
}

/** A key bound to a person acts as that person; a project key as nobody. */
function actorOf(resolved: ResolvedApiKeyCredential): Actor | null {
  if (resolved.type !== "apiKey" || !resolved.userId) return null;

  return { type: "user", id: resolved.userId };
}

/** Who acted, when nobody is behind the credential: the key, or its project. */
function actorIdOf(resolved: ResolvedApiKeyCredential): string {
  if (resolved.type !== "apiKey") return resolved.project.id;

  return resolved.userId ?? resolved.apiKeyId;
}
