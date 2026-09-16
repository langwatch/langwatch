// The process's ONE REST door table: credential kinds it opens and how each
// resolves. Built by boot from peer Apps.
import type { Actor } from "@langwatch/actor";
import type { RateLimiter } from "@langwatch/api";
import {
  bindRestMiddleware,
  createRestRuntime,
  defineRestMiddleware,
  projectRestFacts,
  recordBrowserCaller,
  recordOrganizationCredential,
  recordProjectCredential,
  type MountableRestApp,
  type RestCaller,
  type RestDoorCredential,
  type RestErrorHandler,
  type IdempotentRunner,
  type RestIdentity,
  type RestTransportDeclaration,
  type RestTransportMiddlewareBinding,
} from "@langwatch/api/rest";
import { ApiKeyApi, type ResolvedApiKeyCredential, type ResolvedOrganizationApiKeyToken } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import type {
  FeatureRestHost,
  FeatureRestMountOptions,
  MountableTransport,
  TransportPeers,
} from "@langwatch/runtime-composition";
import { z } from "zod";
import {
  BetterAuthBrowserSessionTransportAdapter,
  composeApiBrowserSession,
  type ApiBrowserSessionResolver,
  type ApiBrowserSessionTransport,
} from "../app/api-auth.composition.ts";
import { apiClientAddress } from "../app/api-client-address.ts";
import { canonicalErrorResponse } from "../app/api-canonical-error.ts";
import {
  ApiRestCredentials,
  type ApiOrganizationCredential,
  type ApiProjectCredential,
} from "./api-rest.credentials.ts";
import {
  ApiRestCapabilityUnavailableError,
  ApiRestDoorUnconfiguredError,
  ApiRestDoorUnverifiedError,
} from "./api-rest.refusals.ts";

/**
 * Every fact this process answers for a module, DECLARED HERE by name rather
 * than imported from the module that reads it: binding is by name and the
 * value is parsed by the ROUTE's own schema, so no value-import is needed.
 */
const unsubscribeCallerAddress = defineRestMiddleware(
  "unsubscribeCallerAddress",
  z.string().nullable(),
);

/**
 * `modules/experiment` — the two SDK doors (`/api/experiment/init`,
 * `/api/dspy/log_steps`) are PUBLIC routes that answer their own bodies, so
 * the key is resolved here with `experiments:manage` as its ceiling.
 */
const experimentInitCaller = defineRestMiddleware(
  "experimentInitCaller",
  z.object({ projectId: z.string(), projectSlug: z.string() }),
);

/** @see experimentInitCaller — the optimizer step log's caller, same ceiling. */
const dspyStepsCaller = defineRestMiddleware(
  "dspyStepsCaller",
  z.object({ projectId: z.string() }),
);

/** The impersonator the back office renders beside the person being acted as. */
const operatorImpersonator = z.object({
  id: z.string().optional(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  image: z.string().nullish(),
});

/** `modules/ops` — the signed-in operator, impersonation included. */
const adminActor = defineRestMiddleware(
  "adminActor",
  z
    .object({
      id: z.string(),
      name: z.string().nullish(),
      email: z.string().nullish(),
      impersonator: operatorImpersonator.optional(),
    })
    .nullable(),
);

/** `modules/ops` — the RAW auth session an impersonation is started against. */
const adminAuthSession = defineRestMiddleware(
  "adminAuthSession",
  z.object({ id: z.string() }).nullable(),
);

/** `modules/hosted-mcp` — who is approving an OAuth consent, if anyone. */
const mcpAuthorizeApprover = defineRestMiddleware(
  "mcpAuthorizeApprover",
  z.object({ user: z.object({ id: z.string() }) }).nullable(),
);

/** `modules/user` — which credential the avatar read is counted against. */
const userAvatarCaller = defineRestMiddleware(
  "userAvatarCaller",
  z.object({ apiKeyProjectId: z.string().nullable(), userId: z.string().nullable() }),
);

/** `modules/model-provider` — the playground's own 401 and 403, as one fact. */
const playgroundRestCaller = defineRestMiddleware(
  "playgroundRestCaller",
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("anonymous") }),
    z.object({ kind: z.literal("signedIn"), userId: z.string(), permitted: z.boolean() }),
  ]),
);

/** `modules/model-provider` — the OpenAI-compatible proxy the playground dials. */
const playgroundRestExecutionProxy = defineRestMiddleware(
  "playgroundRestExecutionProxy",
  z.string(),
);

/** The permission the playground asks of a signed-in person, on one project. */
const PLAYGROUND_PERMISSION = "playground:view" as const;

/** Every door a REST declaration may name, opened by this process or not. */
export type ApiRestDoor = RestDoorCredential | "public";

/**
 * What this process's session verifier left on a request. The two halves of
 * verification fail apart: a cookie Better Auth accepted whose live session
 * cannot resolve carries `authSessionId` and no `userId`, reaching no handler.
 */
export type ApiRestBrowserCaller = Readonly<{
  /** The signed-in person, absent for a verified cookie with no live session. */
  userId?: string | undefined;
  /** Their address, where the resolved session carried one. */
  email?: string | undefined;
  /** Who is acting as them, where somebody is. */
  impersonator?:
    | Readonly<{
        id?: string | undefined;
        name?: string | null | undefined;
        email?: string | null | undefined;
        image?: string | null | undefined;
      }>
    | undefined;
  /** The project a key-credentialled byte caller stands for, where one did. */
  apiKeyProjectId?: string | undefined;
  /** The RAW verified auth-session id, before any live-session lookup. */
  authSessionId?: string | undefined;
}>;

/**
 * The deployment secret guarding each internal family, keyed by namespace: the
 * cron bearer must not also open the agent manager's surface, so the door is
 * chosen per family rather than any secret this deployment happens to hold.
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
  browserSession?: ApiBrowserSessionResolver | undefined;
  /**
   * The deployment's own Better Auth request boundary, taken instead of a
   * resolver: the process supplies only the half no module can (cookie
   * verification); an explicit `browserSession` wins over this one.
   */
  browserSessions?: ApiBrowserSessionTransport | undefined;
  /**
   * Where the OpenAI-compatible execution proxy answers, for the playground.
   * Absent where this deployment named no NLP engine, and the playground then
   * refuses by name rather than streaming at an address that is not there.
   */
  executionProxyBaseUrl?: string | undefined;
  /**
   * The process's ONE receipt ledger, behind every create a route declared
   * replayable. Absent on a deployment with no database, a route declaring the
   * behaviour is refused at mount rather than answering as though protected.
   */
  idempotency?: IdempotentRunner | undefined;
  /**
   * The counter a route declaring `.withRateLimit()` is counted against.
   * Absent on a deployment with no Redis, such a route is refused at mount
   * rather than answering uncounted.
   */
  rateLimiter?: RateLimiter | undefined;
}>;

/** Builds this process's door table once, and mounts declared families on it. */
export class ApiRestHost implements FeatureRestHost<MountableRestApp> {
  static create(options: {
    peers: TransportPeers;
    config: ApiRestDoorConfig;
  }): ApiRestHost {
    const { peers, config } = options;
    const authz = peers.app(AuthzApi);
    const credentials = ApiRestCredentials.create({
      apiKeys: peers.app(ApiKeyApi),
      authz,
      organizations: peers.app(OrganizationApi),
    });

    // The ONE session answer this process gives. The verifying half is the
    // deployment's, the live-session half is the auth module's, and they are
    // joined here so no door can compose a second pair.

    // The verifying half comes from the auth module itself unless this host was
    // handed one: the module builds the deployment's ONE Better Auth instance,
    // so reaching for it through the peer is what keeps a second instance from
    // ever existing over the same cookie namespace.
    const auth = peers.find(AuthApi);
    const sessions =
      config.browserSessions ??
      (auth
        ? BetterAuthBrowserSessionTransportAdapter.create({
            api: { getSession: (input) => auth.tryVerifyBrowserSession(input) },
          })
        : undefined);
    const browserSession =
      config.browserSession ??
      (sessions && auth ? composeApiBrowserSession({ sessions, auth }) : undefined);

    // The directory bearer is an ENTERPRISE module's, so a build without it
    // still mounts the SCIM family and admits nobody through it.
    return new ApiRestHost(
      credentials,
      config,
      browserSession,
      authz,
      peers.find(ScimApi),
      peers.app(AuditLogApi),
    );
  }

  /** The project credential this door resolved, for the facts it binds. */
  private readonly projectCredentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  /**
   * The organization credential, kept against the CALLER as well as the
   * request: `identity.authorize` is handed the answer, not the request.
   */
  private readonly callerCredentials = new WeakMap<RestCaller, ResolvedOrganizationApiKeyToken>();
  private readonly browserCallers = new WeakMap<Request, ApiRestBrowserCaller>();
  /**
   * The session answer for one request, resolved ONCE however many doors ask
   * for it — some routes' doors resolve nobody but still need a session, and
   * verifying it once avoids four round trips to the session store.
   */
  private readonly sessions = new WeakMap<Request, Promise<ApiRestBrowserCaller | null>>();

  private constructor(
    private readonly credentials: ApiRestCredentials,
    private readonly config: ApiRestDoorConfig,
    /** This process's ONE session answer, where it composed a verifier. */
    private readonly browserSession: ApiBrowserSessionResolver | undefined,
    private readonly authz: AuthzApi,
    private readonly scim: Pick<ScimApi, "authenticateDirectory"> | undefined,
    private readonly auditLog: AuditLogApi,
  ) {}

  /**
   * One declared family on the door its declaration named. Every door opens
   * for each mount: a ROUTE may raise its own credential (the cron bearer sits
   * on two routes of a project family), resolved through the door table.
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
      // Every replayable create keeps its receipts in the ONE ledger this
      // process composed: two ledgers over the same table would run two
      // takeover clocks against each other's claims.
      ...(this.config.idempotency ? { idempotency: this.config.idempotency } : {}),
      // Every counted route counts against the ONE limiter this process
      // composed, so two counters can never disagree about one caller.
      ...(this.config.rateLimiter ? { rateLimiter: this.config.rateLimiter } : {}),
      // Every route-declared trail lands on the ONE audit application this
      // process installed; a caller no door named is recorded as anonymous.
      audit: {
        record: (row) =>
          this.auditLog.record({
            userId: row.actorId ?? "anonymous",
            action: row.action,
            args: { ...row.params, ...(row.scope ? { scope: row.scope } : {}) },
            ...(typeof row.params.projectId === "string"
              ? { projectId: row.params.projectId }
              : {}),
            ...(typeof row.params.organizationId === "string"
              ? { organizationId: row.params.organizationId }
              : {}),
            ...(row.resultId ? { targetId: row.resultId } : {}),
            ...(row.errorCode ? { error: row.errorCode } : {}),
          }),
      },
    }).mount(rest, {
      app,
      onError: familyErrors,
      facts: [
        ...this.processFacts(),
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
   * Every organization-scoped family. Permission is asked of the credential at
   * the ORGANIZATION; a route naming its own project asks a SECOND question
   * through `authorize`, making such a route the stricter of the two.
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

  // Shared secret authority: check per route, not per family. Unconfigured
  // answers 404 not 401.
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
   * The byte door a signed-in page reaches. A deployment with no session
   * verifier refuses every request rather than admitting an unverified one:
   * the routes still MOUNT, and nobody reaches a handler without a session.
   */
  private browserDoor(): RestIdentity {
    const admit = async (request: Request): Promise<RestCaller | null> => {
      const caller = await this.sessionOf(request);
      if (!caller?.userId) return null;
      this.browserCallers.set(request, caller);
      recordBrowserCaller(request, { userId: caller.userId });

      return { actor: { type: "user", id: caller.userId }, scope: null };
    };

    return {
      authenticate: () => {
        throw new Error("The byte door asks no permission of the credential it was opened on.");
      },
      identify: async ({ request }) => (await admit(request)) ?? refuse("browser"),
      identifyOptional: ({ request }) => admit(request),
    };
  }

  /**
   * This process's session answer for one request, resolved once and shared
   * by every door and fact that asks. With no verifier composed this answers
   * null for every request, and each reader takes its own refusing branch.
   */
  private sessionOf(request: Request): Promise<ApiRestBrowserCaller | null> {
    const resolved = this.sessions.get(request);
    if (resolved) return resolved;

    const resolving = this.browserSession?.(request) ?? Promise.resolve(null);
    this.sessions.set(request, resolving);

    return resolving;
  }

  /**
   * Every fact this process answers on behalf of a module. Session-bearing
   * facts are bound here because no module can verify a cookie, reading
   * {@link sessionOf} directly rather than resolving one themselves.
   */
  private processFacts(): readonly RestTransportMiddlewareBinding[] {
    return [
      // What this process knows about a caller that no module can: the address
      // a request actually came from, behind the deployment's trusted proxies.
      bindRestMiddleware(unsubscribeCallerAddress, (context) => apiClientAddress(context) ?? null),

      // The experiment SDK doors sit on public routes, so their facts resolve
      // the key themselves; a missing or refused key throws the handled 401
      // the boundary renders, where the door would have answered it.
      bindRestMiddleware(experimentInitCaller, async (context) => {
        const credential = await this.credentials.authenticate({
          request: context.req.raw,
          permission: "experiments:manage",
        });

        return { projectId: credential.project.id, projectSlug: credential.project.slug };
      }),
      bindRestMiddleware(dspyStepsCaller, async (context) => {
        const credential = await this.credentials.authenticate({
          request: context.req.raw,
          permission: "experiments:manage",
        });

        return { projectId: credential.project.id };
      }),

      bindRestMiddleware(adminActor, async (context) => {
        const caller = await this.sessionOf(context.req.raw);
        if (!caller?.userId) return null;

        return {
          id: caller.userId,
          ...(caller.email ? { email: caller.email } : {}),
          ...(caller.impersonator ? { impersonator: caller.impersonator } : {}),
        };
      }),
      // A SEPARATE question from the actor's, and answered from the verified
      // cookie alone: a process that conflated the two would start an
      // impersonation against a session that had already expired.
      bindRestMiddleware(adminAuthSession, async (context) => {
        const caller = await this.sessionOf(context.req.raw);

        return caller?.authSessionId ? { id: caller.authSessionId } : null;
      }),

      // The consent route is PUBLIC - no door runs on it - so the approver is
      // read off the session directly, and the route answers its own 401.
      bindRestMiddleware(mcpAuthorizeApprover, async (context) => {
        const caller = await this.sessionOf(context.req.raw);

        return caller?.userId ? { user: { id: caller.userId } } : null;
      }),

      // Who the byte door let in, read off the door's own answer: the read is
      // counted against the key or the person.
      bindRestMiddleware(userAvatarCaller, async (context) => {
        const caller =
          this.browserCallers.get(context.req.raw) ?? (await this.sessionOf(context.req.raw));

        return {
          apiKeyProjectId: caller?.apiKeyProjectId ?? null,
          userId: caller?.userId ?? null,
        };
      }),

      // The playground's door resolves nobody: the project travels in a
      // header, so the signed-in person and their standing on it arrive as one
      // fact and the route answers its own 401 and 403 from it.
      bindRestMiddleware(playgroundRestCaller, (context) => this.playgroundCaller(context.req.raw)),
      bindRestMiddleware(playgroundRestExecutionProxy, () => this.executionProxy()),
    ];
  }

  /** The signed-in person and their standing on the project a header names. */
  private async playgroundCaller(
    request: Request,
  ): Promise<
    { kind: "anonymous" } | { kind: "signedIn"; userId: string; permitted: boolean }
  > {
    const caller = await this.sessionOf(request);
    if (!caller?.userId) return { kind: "anonymous" };

    const projectId = request.headers.get("x-project-id");
    const permitted = projectId
      ? await this.authz.hasPermission({
          userId: caller.userId,
          permission: PLAYGROUND_PERMISSION,
          projectId,
        })
      : false;

    return { kind: "signedIn", userId: caller.userId, permitted };
  }

  /** Where the playground streams through, or a refusal naming what is absent. */
  private executionProxy(): string {
    const proxy = this.config.executionProxyBaseUrl;
    if (!proxy) throw new ApiRestCapabilityUnavailableError("NLP engine to proxy through");

    return proxy;
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

/** The same refusal, where the caller is an expression rather than a statement. */
function refuse(door: string): never {
  throw refusalFor(door);
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
