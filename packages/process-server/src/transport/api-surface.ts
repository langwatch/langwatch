import type { Actor } from "@langwatch/actor";
import {
  SurfaceBlankSecretError,
  SurfaceUnconfiguredError,
  SurfaceUnverifiedError,
  type RateLimiter,
} from "@langwatch/api";
import { ApiKeyApi, type ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import {
  answerApiFailure,
  composeApiApplication,
  HttpMux,
  BrowserBundle,
  FramedDocument,
  type NodeHandler,
  type TransportSelection,
} from "@langwatch/api/hosting";
import { ClientAddress, SecurityHeaders, type StorageEndpoints } from "@langwatch/api/policy";
import {
  BrowserSessionIdentity,
  bindRestMiddleware,
  defineRestMiddleware,
  IdempotencyLedger,
  projectRestFacts,
  recordKeyCredential,
  recordOrganizationCredential,
  recordProjectCredential,
  recordScimCredential,
  RestHost,
  SessionReader,
  type RestCaller,
  type RestAuditSink,
  type IdempotentRunner,
  type RestIdentity,
  type RestTransportMiddlewareBinding,
} from "@langwatch/api/rest";
import {
  bindTrpcFact,
  defineTrpcFact,
  TrpcHost,
  type TrpcRequestContext,
  type TrpcAuditSink,
} from "@langwatch/api/trpc";
import { AuditLogApi, recordAuditLogCommandSchema } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { ExposedSurface, TransportPeers } from "@langwatch/kernel";
import {
  ModelNotConfiguredError,
  ModelProviderDisabledError,
} from "@langwatch/model-provider-contract";
import type { Logger } from "@langwatch/observability";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { z } from "zod";

import type { ApiUiBundle } from "./bundle-config.ts";
import {
  ApiRestCredentials,
  type ApiKeyDoorCredential,
  type ApiOrganizationCredential,
  type ApiProjectCredential,
} from "./credentials.ts";
import { BetterAuthBrowserSessionTransportAdapter, composeSessionVerification } from "./session.ts";

export type ApiSurfaceComposition = Readonly<{
  members: ProcessMemberSource;
  logger: Logger;
  stores: Readonly<{ database: boolean; redis: boolean }>;
  bundle: ApiUiBundle | undefined;
  storage: StorageEndpoints;
  internalBearers: ReadonlyMap<string, RestIdentity>;
  instanceAdmin: RestIdentity;
  trustedProxies: readonly string[] | undefined;
  executionProxyBaseUrl: string | undefined;
  production: boolean;
  selection: TransportSelection;
}>;

export function apiSurface(
  composition: ApiSurfaceComposition,
): (peers: TransportPeers) => ExposedSurface<unknown, unknown> {
  return (peers) => {
    const surface = ApiSurface.create(composition, peers);

    return { hosts: surface.hosts, serve: () => surface.serve() };
  };
}

class ApiSurface {
  static create(composition: ApiSurfaceComposition, peers: TransportPeers): ApiSurface {
    const { members, logger, stores } = composition;
    const authz = peers.app(AuthzApi);
    const auth = peers.find(AuthApi);
    const sessions = auth
      ? SessionReader.create({
          verify: composeSessionVerification({
            sessions: BetterAuthBrowserSessionTransportAdapter.create({
              api: { getSession: (input) => auth.tryVerifyBrowserSession(input) },
            }),
            auth,
          }),
        })
      : SessionReader.unverified();
    const idempotency = stores.database
      ? IdempotencyLedger.create({
          receipts: members.read("prisma"),
          cipher: members.read("encryption"),
        }).run
      : void 0;
    const rateLimiter = stores.redis ? members.read("rateLimiter") : void 0;

    return new ApiSurface({
      composition,
      peers,
      authz,
      sessions,
      credentials: ApiRestCredentials.create({
        apiKeys: peers.app(ApiKeyApi),
        authz,
        organizations: peers.app(OrganizationApi),
        logger,
      }),
      idempotency,
      rateLimiter,
    });
  }

  readonly #projectCredentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  readonly #callerCredentials = new WeakMap<
    RestCaller,
    Awaited<ReturnType<ApiRestCredentials["authenticateOrganization"]>>["resolved"]
  >();

  readonly #rest: RestHost | undefined;
  readonly #trpc: TrpcHost | undefined;

  private readonly composition: ApiSurfaceComposition;
  private readonly authz: AuthzApi;
  private readonly sessions: SessionReader;
  private readonly credentials: ApiRestCredentials;

  private constructor({
    composition,
    peers,
    authz,
    sessions,
    credentials,
    idempotency,
    rateLimiter,
  }: {
    composition: ApiSurfaceComposition;
    peers: TransportPeers;
    authz: AuthzApi;
    sessions: SessionReader;
    credentials: ApiRestCredentials;
    idempotency: IdempotentRunner | undefined;
    rateLimiter: RateLimiter | undefined;
  }) {
    this.composition = composition;
    this.authz = authz;
    this.sessions = sessions;
    this.credentials = credentials;
    if (composition.selection.selected.rest)
      this.#rest = this.#restHost(peers, idempotency, rateLimiter);
    if (composition.selection.selected.trpc) this.#trpc = this.#trpcHost(peers, rateLimiter);
  }

  #restHost(
    peers: TransportPeers,
    idempotency: IdempotentRunner | undefined,
    rateLimiter: RateLimiter | undefined,
  ): RestHost {
    return RestHost.create({
      identities: {
        project: this.#projectDoor(),
        organization: this.#organizationDoor(),
        apiKey: this.#keyDoor(),
        browser: this.#browserDoor(),
        scimToken: this.#directoryDoor(peers.find(ScimApi)),
        "instance-admin": this.composition.instanceAdmin,
      },
      bearers: (namespace) =>
        this.composition.internalBearers.get(namespace) ??
        bearerDoor({ name: namespace, token: void 0 }),
      audit: restAudit(peers.app(AuditLogApi)),
      idempotency,
      rateLimiter,
      facts: this.#restFacts(),
    });
  }

  #trpcHost(peers: TransportPeers, rateLimiter: RateLimiter | undefined): TrpcHost {
    return TrpcHost.create({
      sessions: this.sessions,
      authz: this.authz,
      logger: this.composition.logger,
      errorCausePayload: { payloadFor: browserCausePayload },
      audit: trpcAudit(peers.find(AuditLogApi)),
      throttle: rateLimiter ? { limiter: rateLimiter, policies: {} } : void 0,
      facts: this.#trpcFacts(),
    });
  }

  get hosts(): { rest: RestHost | undefined; trpc: TrpcHost | undefined } {
    return { rest: this.#rest, trpc: this.#trpc };
  }

  serve(): NodeHandler {
    const { composition } = this;
    const { bundle } = composition;
    const selected = composition.selection.selected;
    const page = BrowserBundle.create({
      dist: selected.bundle ? bundle?.directory : void 0,
      publicConfig: () => bundle?.head ?? "",
      sessionReader: this.sessions,
      security: selected.bundle ? selected.bundle.security : SecurityHeaders.strict(),
      ...(selected.bundle && selected.bundle.authorizeDocument
        ? { authorizeDocument: selected.bundle.authorizeDocument }
        : {}),
    });
    const api = composeApiApplication({ rest: this.#rest, trpc: this.#trpc }, selected);
    const mux = HttpMux.create({ reporter: composition.logger })
      .use(ClientAddress.fromTrustedProxies({ addresses: composition.trustedProxies }))
      .use(SecurityHeaders.strict({ production: composition.production }))
      .route("/api", api, { onFailure: answerApiFailure });
    for (const document of selected.documents)
      mux.route(document.path, FramedDocument.create(document));
    return mux.route("/", page).handler;
  }

  #projectDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission }) =>
        this.#projectCaller(request, await this.credentials.authenticate({ request, permission })),
      identify: async ({ request }) =>
        this.#projectCaller(request, await this.credentials.identify({ request })),
    };
  }

  #projectCaller(request: Request, credential: ApiProjectCredential): RestCaller {
    this.#projectCredentials.set(request, credential.resolved);
    recordProjectCredential(request, credential.resolved);

    return {
      actor: actorOf(credential.resolved),
      scope: { tier: "project", id: credential.project.id },
      markUsed: credential.markUsed,
    };
  }

  #organizationDoor(): RestIdentity {
    return {
      authenticate: async ({ request, permission }) =>
        this.#organizationCaller(
          request,
          await this.credentials.authenticateOrganization({ request, permission }),
        ),
      identify: async ({ request }) =>
        this.#organizationCaller(request, await this.credentials.identifyOrganization({ request })),
      authorize: ({ caller, permission, target }) => {
        if (target.tier !== "project") {
          throw new Error(
            `The organization door answers a route-scoped permission at a project, and ` +
              `"${permission}" was asked at a ${target.tier}`,
          );
        }
        const credential = this.#callerCredentials.get(caller);
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

  #organizationCaller(request: Request, credential: ApiOrganizationCredential): RestCaller {
    recordOrganizationCredential(request, credential.resolved);
    const caller: RestCaller = {
      actor: credential.resolved.userId ? { type: "user", id: credential.resolved.userId } : null,
      scope: { tier: "organization", id: credential.resolved.organizationId },
      markUsed: credential.markUsed,
    };
    this.#callerCredentials.set(caller, credential.resolved);

    return caller;
  }

  /** Any API key, fanned out by the feature rather than pinned to a project here. */
  #keyDoor(): RestIdentity {
    return {
      authenticate: () => {
        throw new Error("The key door asks no permission: the feature decides what the key reads.");
      },
      identify: async ({ request }) =>
        this.#keyCaller(request, await this.credentials.identifyKey({ request })),
    };
  }

  #keyCaller(request: Request, credential: ApiKeyDoorCredential): RestCaller {
    recordKeyCredential(request, credential.principal);
    const { principal } = credential;

    return {
      actor:
        principal.kind === "apiKey" && principal.userId
          ? { type: "user", id: principal.userId }
          : null,
      scope: { tier: "organization", id: credential.organizationId },
      markUsed: credential.markUsed,
    };
  }

  #browserDoor(): RestIdentity {
    return BrowserSessionIdentity.create(this.sessions, this.authz);
  }

  #directoryDoor(scim: ScimApi | undefined): RestIdentity {
    const identify = async ({ request }: { request: Request }): Promise<RestCaller> => {
      if (!scim) throw new SurfaceUnverifiedError("scimToken");
      const directory = await scim.authenticateDirectory({
        authorization: request.headers.get("authorization"),
        method: request.method,
        path: new URL(request.url).pathname,
      });

      recordScimCredential(request, directory);

      return {
        actor: { type: "api_key", id: directory.id },
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

  async #adminActor(request: Request) {
    const caller = await this.sessions.read(request);
    if (!caller?.userId) return null;
    return { id: caller.userId, email: caller.email, impersonator: caller.impersonator };
  }

  #restFacts(): readonly RestTransportMiddlewareBinding[] {
    return [
      bindRestMiddleware(
        unsubscribeCallerAddress,
        (context) => ClientAddress.resolvedFor(context.req.raw) ?? null,
      ),
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

      bindRestMiddleware(adminActor, (context) => this.#adminActor(context.req.raw)),
      bindRestMiddleware(adminAuthSession, async (context) => {
        const caller = await this.sessions.read(context.req.raw);

        return caller?.authSessionId ? { id: caller.authSessionId } : null;
      }),
      bindRestMiddleware(adminAuditRequest, (context) => {
        const headers: Record<string, string> = {};
        context.req.raw.headers.forEach((value, name) => {
          headers[name] = value;
        });

        return { headers };
      }),
      bindRestMiddleware(userAvatarCaller, async (context) => {
        const caller = await this.sessions.read(context.req.raw);

        return {
          apiKeyProjectId: caller?.apiKeyProjectId ?? null,
          userId: caller?.userId ?? null,
        };
      }),
      bindRestMiddleware(projectRestFacts, (context) => {
        const credential = this.#projectCredentials.get(context.req.raw);
        if (!credential) {
          throw new Error("The project door resolved no credential for this request");
        }

        return {
          projectSlug: credential.project.slug,
          viewerUserId: credential.type === "apiKey" ? (credential.userId ?? null) : null,
          actorId: actorIdOf(credential),
        };
      }),
    ];
  }

  #trpcFacts() {
    return [
      bindTrpcFact(callerEmailFact, (ctx: TrpcRequestContext) => ctx.session?.user.email ?? null),
      bindTrpcFact(organizationSessionPersonFact, (ctx: TrpcRequestContext) =>
        ctx.session?.user
          ? { name: ctx.session.user.name ?? null, email: ctx.session.user.email ?? null }
          : null,
      ),
      bindTrpcFact(opsOperatorFact, (ctx: TrpcRequestContext) =>
        ctx.session?.user
          ? {
              id: ctx.session.user.id,
              name: ctx.session.user.name ?? null,
              email: ctx.session.user.email ?? null,
              impersonator: ctx.session.user.impersonator
                ? {
                    id: ctx.session.user.impersonator.id,
                    email: ctx.session.user.impersonator.email ?? null,
                  }
                : null,
            }
          : null,
      ),
      bindTrpcFact(gatewaySessionFact, (ctx: TrpcRequestContext) => ctx.session ?? null),
      bindTrpcFact(shareViewerFact, (ctx: TrpcRequestContext) => {
        const userAgent = ctx.req?.headers["user-agent"];
        return {
          userId: ctx.tryActor()?.id ?? null,
          userAgent: typeof userAgent === "string" ? userAgent : null,
        };
      }),
    ];
  }
}

export function bearerDoor(options: { name: string; token: string | undefined }): RestIdentity {
  const { name, token } = options;
  const admit = (request: Request): RestCaller => {
    if (token === void 0) throw new SurfaceUnconfiguredError(name);
    const configured = token.trim();
    if (configured === "") throw new SurfaceBlankSecretError(name);
    const header = request.headers.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
    if (presented !== configured) throw new SurfaceUnverifiedError(name);
    return { actor: null, scope: null, internal: { type: "internalSecret", secretName: name } };
  };

  return {
    authenticate: () => {
      throw new Error(`The "${name}" door asks no permission of the bearer it was opened on.`);
    },
    identify: ({ request }) => admit(request),
    identifyOptional: ({ request }) => admit(request),
  };
}

function actorOf(resolved: ResolvedApiKeyCredential): Actor | null {
  if (resolved.type !== "apiKey" || !resolved.userId) return null;

  return { type: "user", id: resolved.userId };
}

function actorIdOf(resolved: ResolvedApiKeyCredential): string {
  if (resolved.type !== "apiKey") return resolved.project.id;

  return resolved.userId ?? resolved.apiKeyId;
}

function browserCausePayload(cause: unknown): Record<string, unknown> | null {
  if (cause instanceof ModelNotConfiguredError) {
    return {
      code: cause.cause,
      featureKey: cause.featureKey,
      featureDisplayName: cause.featureDisplayName,
      role: cause.role,
      projectId: cause.projectId,
    };
  }
  if (cause instanceof ModelProviderDisabledError) return cause.toResponseBody();
  const aiFailure = aiFailureSchema.safeParse(cause);
  if (aiFailure.success) {
    const cause = aiFailure.data;
    return {
      code: cause.cause,
      featureKey: cause.featureKey,
      featureDisplayName: cause.featureDisplayName,
      role: cause.role,
    };
  }
  const limit = cause as { limitType?: string; current?: number; max?: number } | undefined;

  return limit?.limitType
    ? { limitType: limit.limitType, current: limit.current, max: limit.max }
    : null;
}

const unsubscribeCallerAddress = defineRestMiddleware(
  "unsubscribeCallerAddress",
  z.string().nullable(),
);

const experimentInitCaller = defineRestMiddleware(
  "experimentInitCaller",
  z.object({ projectId: z.string(), projectSlug: z.string() }),
);

const dspyStepsCaller = defineRestMiddleware(
  "dspyStepsCaller",
  z.object({ projectId: z.string() }),
);

const operatorImpersonator = z.object({
  id: z.string().optional(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  image: z.string().nullish(),
});

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

const adminAuthSession = defineRestMiddleware(
  "adminAuthSession",
  z.object({ id: z.string() }).nullable(),
);

const adminAuditRequest = defineRestMiddleware(
  "adminAuditRequest",
  z.object({ headers: z.record(z.string(), z.string()) }),
);

const userAvatarCaller = defineRestMiddleware(
  "userAvatarCaller",
  z.object({ apiKeyProjectId: z.string().nullable(), userId: z.string().nullable() }),
);

const callerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());
const organizationSessionPersonFact = defineTrpcFact("organizationSessionPerson", z.unknown());
const opsOperatorFact = defineTrpcFact("opsOperator", z.unknown());
const gatewaySessionFact = defineTrpcFact("gatewaySession", z.unknown());
const shareViewerFact = defineTrpcFact(
  "shareViewer",
  z.object({ userId: z.string().nullable(), userAgent: z.string().nullable() }),
);
const aiFailureSchema = z.object({
  code: z.literal("ai_call_failed"),
  cause: z.string(),
  featureKey: z.string(),
  featureDisplayName: z.string(),
  role: z.string(),
});

function restAudit(audit: AuditLogApi): RestAuditSink {
  return {
    record: (row) =>
      audit.record({
        userId: row.actorId ?? "anonymous",
        action: row.action,
        args: { ...row.params, scope: row.scope },
        projectId: typeof row.params.projectId === "string" ? row.params.projectId : void 0,
        organizationId:
          typeof row.params.organizationId === "string" ? row.params.organizationId : void 0,
        targetId: row.resultId || void 0,
        error: row.errorCode,
      }),
  };
}

function trpcAudit(audit: AuditLogApi | undefined): TrpcAuditSink | undefined {
  if (!audit) return void 0;
  return {
    record: (entry) => {
      let args: unknown;
      if (entry.args !== void 0) args = JSON.parse(JSON.stringify(entry.args));
      return audit.record(
        recordAuditLogCommandSchema.parse({
          userId: entry.userId,
          action: entry.action,
          args,
          organizationId: entry.organizationId,
          projectId: entry.projectId,
          error: entry.error?.toString(),
        }),
      );
    },
  };
}
