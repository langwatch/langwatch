/**
 * The process's ONE REST door table, and the host boot mounts every module's
 * declared family on.
 *
 * A module never mounts itself and the process never re-declares a route: what
 * the process owns is the DOORS - which credential kinds it opens, what each
 * resolves, and the envelope a refusal is written in. `apiRestHosts` is a
 * factory rather than a value because every door here is built from a peer App
 * (api-key, authz, organization, scim), and those are resolved by the same
 * boot that mounts the routes.
 */
import type { Actor } from "@langwatch/actor";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  recordBrowserCaller,
  recordOrganizationCredential,
  recordProjectCredential,
  type MountableRestApp,
  type RestCaller,
  type RestDoorCredential,
  type RestErrorHandler,
  type RestIdentity,
  type RestTransportDeclaration,
  type RestTransportMiddlewareBinding,
} from "@langwatch/api/rest";
import { ApiKeyApi, type ResolvedApiKeyCredential, type ResolvedOrganizationApiKeyToken } from "@langwatch/api-key-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type {
  FeatureRestHost,
  FeatureRestMountOptions,
  FeatureTransportHosts,
  MountableTransport,
  TransportPeers,
} from "@langwatch/runtime-composition";
import { canonicalErrorResponse } from "../app/api-canonical-error.ts";
import { ApiRestCredentials } from "./api-rest.credentials.ts";
import {
  ApiRestDoorUnconfiguredError,
  ApiRestDoorUnverifiedError,
} from "./api-rest.refusals.ts";

/** Every door a REST declaration may name, opened by this process or not. */
export type ApiRestDoor = RestDoorCredential | "public";

/** What the byte door's verifier left on a request it let through. */
export type ApiRestBrowserCaller = Readonly<{ userId?: string | undefined }>;

/**
 * The deployment secret that guards each internal family, by the family's own
 * namespace. One door, several secrets: the cron bearer must not reach the
 * agent manager's internal surface, so the door is chosen per family rather
 * than accepting any secret this deployment happens to hold.
 */
export type ApiRestInternalSecrets = Readonly<Record<string, string | undefined>>;

/** What the process states about its own doors, beyond the peers boot resolves. */
export type ApiRestDoorConfig = Readonly<{
  /** The deployment's own shared secrets, by the family each one guards. */
  internalSecrets?: ApiRestInternalSecrets;
  /** The instance administrator bearer, absent where unconfigured or SaaS. */
  instanceAdminKey?: string | undefined;
  /**
   * What a browser cookie resolved, where this deployment composed a verifier.
   * Absent, the byte door still MOUNTS - the routes exist and answer 401 -
   * rather than letting an unverified caller through.
   */
  browserSession?: ((request: Request) => Promise<ApiRestBrowserCaller | null>) | undefined;
}>;

/**
 * The doors this process opens, and the hosts boot mounts the declared
 * transports on. Every credential kind an installed module's declaration may
 * name is opened here, so a mount refuses by KIND only for a kind nothing in
 * this build declares.
 */
export function apiRestHosts(options: {
  readonly config: ApiRestDoorConfig;
}): (peers: TransportPeers) => FeatureTransportHosts<MountableRestApp, never> {
  return (peers) => ({ rest: ApiRestHost.create({ peers, config: options.config }) });
}

/** Builds this process's door table once, and mounts declared families on it. */
export class ApiRestHost implements FeatureRestHost<MountableRestApp> {
  static create(options: {
    peers: TransportPeers;
    config: ApiRestDoorConfig;
  }): ApiRestHost {
    const { peers, config } = options;
    const credentials = ApiRestCredentials.create({
      apiKeys: peers.app(ApiKeyApi),
      authz: peers.app(AuthzApi),
      organizations: peers.app(OrganizationApi),
    });

    // The directory bearer is an ENTERPRISE module's, so a build without it
    // still mounts the SCIM family and admits nobody through it.
    return new ApiRestHost(credentials, config, peers.find(ScimApi));
  }

  /** The project credential this door resolved, for the facts it binds. */
  private readonly projectCredentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  /**
   * The organization credential, kept against the CALLER as well as the
   * request: `identity.authorize` is handed the answer, not the request.
   */
  private readonly callerCredentials = new WeakMap<RestCaller, ResolvedOrganizationApiKeyToken>();
  private readonly browserCallers = new WeakMap<Request, ApiRestBrowserCaller>();

  private constructor(
    private readonly credentials: ApiRestCredentials,
    private readonly config: ApiRestDoorConfig,
    private readonly scim: Pick<ScimApi, "authenticateDirectory"> | undefined,
  ) {}

  /**
   * One declared family on the door its declaration named.
   *
   * Every door is opened for each mount, not only the family's own: a ROUTE
   * may raise a credential of its own - the deployment's cron bearer sits on
   * two routes of a project family - and the runtime resolves that route
   * through the door table rather than through the family's door.
   */
  mount(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureRestMountOptions,
  ): MountableRestApp {
    const rest = declaration as RestTransportDeclaration<unknown>;
    const door = doorOf(rest);
    const doors = this.doorsFor(rest);

    return createRestRuntime({
      identity: door === "public" ? this.publicDoor() : doors[door],
      doors,
    }).mount(rest, {
      app,
      onError: familyErrors,
      facts: [
        ...(door === "project" ? [this.projectFacts()] : []),
        ...((options?.facts ?? []) as readonly RestTransportMiddlewareBinding[]),
      ],
    });
  }

  /**
   * Every credential kind this process opens, for one family. The internal
   * secret is bound to the FAMILY here rather than shared: one door, several
   * secrets, so a cron bearer cannot reach the agent manager's own surface.
   */
  private doorsFor(
    declaration: RestTransportDeclaration<unknown>,
  ): Record<RestDoorCredential, RestIdentity> {
    return {
      project: this.projectDoor(),
      organization: this.organizationDoor(),
      scimToken: this.directoryDoor(),
      "instance-admin": this.bearerDoor({
        secret: this.config.instanceAdminKey,
        door: "instance-admin",
      }),
      browser: this.browserDoor(),
      internalSecret: this.bearerDoor({
        secret: this.config.internalSecrets?.[declaration.namespace],
        door: declaration.namespace,
        // The runtime makes a shared-secret door NAME the secret that let the
        // request in, so a trail records which one rather than "some bearer".
        secretName: declaration.namespace,
      }),
    };
  }

  /**
   * The SCIM 2.0 provisioning door. No permission is asked of the bearer:
   * holding it IS the authority, so a gated route identifies rather than
   * authenticates, and the bearer stands for its TENANT and nobody inside it.
   */
  private directoryDoor(): RestIdentity {
    const scim = this.scim;
    const identify = async ({ request }: { request: Request }): Promise<RestCaller> => {
      if (!scim) throw refusalFor("scimToken");
      const directory = await scim.authenticateDirectory({
        authorization: request.headers.get("authorization"),
      });

      return {
        actor: { type: "api_key", id: directory.organizationId },
        scope: { tier: "organization", id: directory.organizationId },
      };
    };

    return {
      authenticate: () => {
        throw new Error("The SCIM door asks no permission of the bearer it was opened on.");
      },
      identify,
    };
  }

  /** Every route of the family is public: nothing is resolved for any of them. */
  private publicDoor(): RestIdentity {
    return {
      authenticate: () => {
        throw new Error("A public REST route answers with no credential resolved.");
      },
    };
  }

  /** Every project-scoped family: the key is resolved once, and refused once. */
  private projectDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission }): Promise<RestCaller> =>
        this.projectCaller(request, await this.credentials.authenticate({ request, permission })),
      // A route that answers any authenticated caller asks the door for no
      // permission, so there is nothing to enforce as the key's ceiling.
      identify: async ({ request }): Promise<RestCaller> =>
        this.projectCaller(request, await this.credentials.identify({ request })),
    };
  }

  /** What the project door answers with, and where its credential is kept. */
  private projectCaller(request: Request, credential: ApiProjectCredential): RestCaller {
    this.projectCredentials.set(request, credential.resolved);
    // The same answer, where a MODULE's own fact binding reads it. The door
    // resolves once; nothing downstream asks the key store a second time.
    recordProjectCredential(request, credential.resolved);

    return {
      actor: actorOf(credential.resolved),
      scope: { tier: "project", id: credential.project.id },
      markUsed: credential.markUsed,
    };
  }

  /**
   * Every organization-scoped family. The permission is asked of the credential
   * at the ORGANIZATION, the only scope this door resolves; a route that names
   * its own project asks a SECOND question through `authorize` rather than
   * replacing this one, so such a route is the stricter of the two.
   */
  private organizationDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission }): Promise<RestCaller> =>
        this.organizationCaller(
          request,
          await this.credentials.authenticateOrganization({ request, permission }),
        ),
      identify: async ({ request }): Promise<RestCaller> =>
        this.organizationCaller(request, await this.credentials.identifyOrganization({ request })),
      authorize: ({ caller, permission, target }) => {
        if (target.tier !== "project") {
          throw new Error(
            `The organization door answers a route-scoped permission at a project, and ` +
              `"${permission}" was asked at a ${target.tier}`,
          );
        }
        const credential = this.callerCredentials.get(caller);
        if (!credential) {
          throw new Error("The organization door authorized a caller it did not resolve");
        }

        return this.credentials.authorizeOrganizationRoute({
          credential,
          permission,
          projectId: target.id,
        });
      },
    };
  }

  /**
   * A deployment's own shared secret - the instance administrator bearer, the
   * cron bearer, the agent manager's. Holding it IS the authority, so the door
   * asks no permission and the check runs HERE rather than as a family
   * middleware: these credentials are raised per ROUTE as often as per family,
   * and a gate mounted under the family's paths would miss every one of them.
   *
   * Unconfigured answers 404 rather than 401: whether this deployment holds a
   * given secret is not something a caller presenting the wrong one learns.
   */
  private bearerDoor(options: {
    secret: string | undefined;
    door: string;
    secretName?: string;
  }): RestIdentity {
    const { secret, door, secretName } = options;
    const presentedBy = (request: Request): string => {
      const header = request.headers.get("authorization") ?? "";
      return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
    };
    const admit = (request: Request): RestCaller => {
      const configured = secret?.trim();
      if (!configured) throw new ApiRestDoorUnconfiguredError(door);
      if (presentedBy(request) !== configured) throw refusalFor(door);

      return {
        actor: null,
        scope: null,
        ...(secretName ? { internal: { type: "internalSecret" as const, secretName } } : {}),
      };
    };

    return {
      authenticate: () => {
        throw new Error(`The "${door}" door asks no permission of the bearer it was opened on.`);
      },
      identify: ({ request }) => admit(request),
      identifyOptional: ({ request }) => admit(request),
    };
  }

  /**
   * The byte door a signed-in page reaches. A deployment that composed no
   * session verifier refuses every request rather than admitting an unverified
   * one: the routes still MOUNT, so the surface is the one the document
   * describes, and nobody reaches a handler without a session.
   */
  private browserDoor(): RestIdentity {
    const resolve = this.config.browserSession;
    const session = async (request: Request): Promise<RestCaller> => {
      const caller = await resolve?.(request);
      if (!caller?.userId) throw refusalFor("browser");
      this.browserCallers.set(request, caller);
      recordBrowserCaller(request, { userId: caller.userId });

      return { actor: { type: "user", id: caller.userId }, scope: null };
    };

    return {
      authenticate: () => {
        throw new Error("The byte door asks no permission of the credential it was opened on.");
      },
      identify: ({ request }) => session(request),
      identifyOptional: async ({ request }) => {
        const caller = await resolve?.(request);
        if (!caller?.userId) return null;
        this.browserCallers.set(request, caller);
        recordBrowserCaller(request, { userId: caller.userId });

        return { actor: { type: "user", id: caller.userId }, scope: null };
      },
    };
  }

  /**
   * What a project-scoped door knows about its caller beyond the request:
   * bound once, here, so a family declaring the fact binds nothing for it.
   */
  private projectFacts(): RestTransportMiddlewareBinding {
    return bindRestMiddleware(projectRestFacts, (context) => {
      const credential = this.projectCredentials.get(context.req.raw);
      if (!credential) throw new Error("The project door resolved no credential for this request");

      return {
        projectSlug: credential.project.slug,
        viewerUserId: credential.type === "apiKey" ? (credential.userId ?? null) : null,
        actorId: actorIdOf(credential),
      };
    });
  }

  /**
   * What the organization door answers with, and where the credential behind a
   * second permission question is kept.
   */
  private organizationCaller(
    request: Request,
    credential: ApiOrganizationCredential,
  ): RestCaller {
    recordOrganizationCredential(request, credential.resolved);
    const caller: RestCaller = {
      actor: credential.resolved.userId ? { type: "user", id: credential.resolved.userId } : null,
      scope: { tier: "organization", id: credential.resolved.organizationId },
      markUsed: credential.markUsed,
    };
    this.callerCredentials.set(caller, credential.resolved);

    return caller;
  }
}

function refusalFor(door: string): ApiRestDoorUnverifiedError {
  return new ApiRestDoorUnverifiedError(door);
}

/**
 * The door a family answers behind, read off its DECLARATION. A family whose
 * every route is public resolves nothing at all, whatever credential the
 * declaration nominally carries.
 */
function doorOf(declaration: RestTransportDeclaration<unknown>): ApiRestDoor {
  return declaration.routes.every((route) => route.access?.kind === "public")
    ? "public"
    : declaration.credential;
}

/** The envelope a family that names none of its own answers a refusal in. */
const familyErrors: RestErrorHandler = (error, context) => canonicalErrorResponse(error, context);

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
