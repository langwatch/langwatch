/**
 * The worker's door onto the developer's folder (ADR-129), deliberately NOT
 * under `/api/internal`. Every refusal is a `HandledError`: the worker's
 * stderr is `/dev/null`, so the HTTP answer is all it has.
 */

import { handlerManagedAuth } from "@langwatch/api";
import {
  bodyLimit,
  type AppRestSecurity,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type ServiceContext,
} from "@langwatch/api/rest";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  CALL_POLL_HOLD_MS,
  createControlRequestResponseSchema,
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
  SHARE_CONTROL_COMMAND,
  workspaceStatusSchema,
  langyLocalCallIdParamsSchema,
  langyLocalStartCallRequestSchema,
  langyLocalStartWaitRequestSchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

import type { LangyApp } from "#app/langy.app";
import type { LocalControlRuntime } from "#adapters/langy-local-control-runtime.adapter";
import { LangyKeyIdentityService } from "#services/langy-key-identity.service";
import type { ControlSkipGate } from "#rules/langy-local-session-contract.rules";
import { conversationTitle, conversationUrl } from "#rules/langy-local-session-text.rules";
import { ControlRequestService } from "#services/langy-local-control-request.service";
import { reconcileSkipPolicy } from "#rules/langy-local-skip-policy.rules";
import type { UserWaitEvents } from "../../rules/langy-local-user-wait-record.rules.ts";
import type { LangyRestCredentialPorts } from "./langy-rest-credentials.api.ts";
import { nowInstant } from "@langwatch/time";

const AUTH_REASON =
  "session key resolved in-handler by the API-key service, then bridged to the owning user by " +
  "the key-identity service; the conversation in the body is proved against that user and project";

/** A local call is a small JSON document, never an upload. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * The permission this door declares AND the one it enforces. One constant, so
 * the declaration the OpenAPI surface publishes and the check the handler runs
 * cannot drift into disagreeing about what a caller needs.
 */
const LOCAL_PERMISSION = "langy:create" as const;

const localAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: [LOCAL_PERMISSION],
  credential: "apiKey",
});

/** The conversation writes this door and its runtime record. */
export type LangyLocalRestCommands = UserWaitEvents &
  Readonly<{
    requestLocalControl(input: {
      tenantId: string;
      occurredAt: number;
      conversationId: string;
      requestId: string;
      userId: string;
      expiresAt: number;
      command: string;
    }): Promise<unknown>;
    changeLocalPolicy(input: {
      tenantId: string;
      occurredAt: number;
      conversationId: string;
      userId: string;
      skipPermissions: boolean;
      model: string;
    }): Promise<unknown>;
  }>;

/** Whether the person behind the key chose GitHub over a shared folder. */
export type LangyCodeAccessPreferenceReader = Readonly<{
  tryReadPreference(userId: string): Promise<string | null>;
}>;

/** Whether the organization installed the GitHub App, for the code access card. */
export type LangyGithubInstallationReader = Readonly<{
  readInstallation(projectId: string): Promise<{ installed: boolean; accountLogin?: string }>;
}>;

/** Everything the local surface reaches that Langy does not own. */
export type LangyLocalRestPorts = LangyRestCredentialPorts &
  Readonly<{
    /** The SAME application the browser's Langy procedures resolve on. */
    langy: () => LangyApp;
    /** This process's local-control runtime: presence, calls, waits, requests. */
    runtime: () => LocalControlRuntime;
    /** The durable record of a request and of a revoked skip policy. */
    commands: () => LangyLocalRestCommands;
    /** The person's own code access choice. */
    users: () => LangyCodeAccessPreferenceReader;
    /** The GitHub half of the code access card. */
    github: () => LangyGithubInstallationReader;
    /** This deployment's own origin, for the follow-along link. */
    baseHost: string | undefined;
    /** Whether the conversation's model may skip permission cards. */
    skipGate: ControlSkipGate;
  }>;

export function createLangyLocalRestApp(options: {
  security: AppRestSecurity;
  ports: LangyLocalRestPorts;
}): MountableRestApp {
  const { security, ports } = options;

  const { service: restService, policy } = security.createServiceVersionedApp({
    name: "langy-local",
    basePath: "/api/langy",
    // The command line posts these exact paths; the surface serves one
    // generation rather than a dated namespace.
    staticGeneration: "v1",
    errorEnvelope: "canonical",
  });

  const localDoor = policy(localAuth);

  /**
   * Authenticate the key, enforce the permission this door declares, then
   * resolve the owning user. Order is the shared chain's: credential (401),
   * the KEY's own ceiling (403), then the identity bridge. The ceiling is
   * checked against the credential rather than its holder — a deliberately
   * narrowed key must not reach local control on the strength of what the
   * person who made it may do.
   */
  const authorize = async (c: ServiceContext<EndpointVariables>) => {
    const credentials = ports.readCredential(c.req.raw);
    if (!credentials) throw new LangyApiCredentialMissingError();

    const resolved = await ports.apiKeys().findResolvedToken({
      token: credentials.token,
      projectId: credentials.projectId,
    });
    if (!resolved) throw new LangyApiCredentialInvalidError();

    await ports.enforceCeiling({ resolved, permission: LOCAL_PERMISSION });

    const identity = await LangyKeyIdentityService.create({
      featureFlags: ports.featureFlags(),
    }).resolve({ resolved });
    if (!identity.ok) {
      throw new LangyApiIdentityDeniedError(
        identity.reason === "unowned" ? "langy_api_key_unowned" : "langy_api_key_no_langy_access",
        identity.message,
      );
    }
    return {
      userId: identity.userId,
      projectId: resolved.project.id,
      projectName: resolved.project.name,
      projectSlug: resolved.project.slug,
    };
  };

  /**
   * The conversation the caller named, proved against the key. Invisible
   * dies as not-found, not refusal, so a foreign id never confirms it exists.
   */
  const requireConversation = async (input: {
    conversationId: string;
    projectId: string;
    userId: string;
  }) => {
    const conversation = await ports.langy().tryFindVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
    });
    if (!conversation) throw new LangyConversationNotFoundError(input.conversationId);
    return conversation;
  };

  const parseBody = async <T extends z.ZodType>(
    c: ServiceContext<EndpointVariables>,
    schema: T,
  ): Promise<z.infer<T>> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new LangyApiRequestInvalidError(parsed.error.issues);
    }
    return parsed.data;
  };

  // ── what `code_access` reads ──────────────────────────────────────────────

  const workspaceHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const conversationId = c.req.query("conversationId") ?? "";
    await requireConversation({ ...auth, conversationId });

    const runtime = ports.runtime();
    const connected = await runtime.presence.read(conversationId);
    const pendingRequest = await runtime.requests.tryFindOpenForConversation({
      projectId: auth.projectId,
      userId: auth.userId,
      conversationId,
    });
    const preference = await ports.users().tryReadPreference(auth.userId);
    const github = await ports.github().readInstallation(auth.projectId);

    return c.json(
      workspaceStatusSchema.parse({
        connected: connected !== null,
        ...(connected ? { workspace: connected.workspace } : {}),
        codeAccessPreference: preference === "github" ? "github" : null,
        github,
        ...(pendingRequest ? { pendingRequest: ControlRequestService.toWire(pendingRequest) } : {}),
      }),
      200,
    );
  };

  // ── the control request the card renders ──────────────────────────────────

  const createRequestHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const body = await parseBody(c, z.object({ conversationId: z.string().min(1) }));
    const conversation = await requireConversation({
      ...auth,
      conversationId: body.conversationId,
    });

    const request = await ports.runtime().requests.create({
      projectId: auth.projectId,
      projectName: auth.projectName,
      userId: auth.userId,
      conversationId: conversation.id,
      conversationTitle: conversationTitle(conversation.title),
      conversationUrl: conversationUrl(conversation.id, ports.baseHost, auth.projectSlug),
    });
    await ports.commands().requestLocalControl({
      tenantId: auth.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: conversation.id,
      requestId: request.id,
      userId: auth.userId,
      expiresAt: request.expiresAt,
      command: SHARE_CONTROL_COMMAND,
    });

    return c.json(
      createControlRequestResponseSchema.parse({
        request: ControlRequestService.toWire(request),
        command: SHARE_CONTROL_COMMAND,
      }),
      200,
    );
  };

  // ── one local tool call ───────────────────────────────────────────────────

  const startCallHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const body = await parseBody(c, langyLocalStartCallRequestSchema);
    const conversation = await requireConversation({
      ...auth,
      conversationId: body.conversationId,
    });

    // The skip choice is answered by the model the conversation runs on, and
    // that model can change between two calls, so it is re-read here: the
    // command that would have run without a card asks again.
    await reconcileSkipPolicy({
      runtime: ports.runtime(),
      projectId: auth.projectId,
      conversationId: body.conversationId,
      model: conversation.lastModel,
      skipGate: ports.skipGate,
      changePolicy: async (args) => {
        await ports.commands().changeLocalPolicy({
          tenantId: auth.projectId,
          occurredAt: nowInstant().epochMilliseconds,
          ...args,
        });
      },
    });

    const timeoutMs =
      body.tool === "local_bash" && body.params.timeout
        ? body.params.timeout * 1000
        : BASH_DEFAULT_TIMEOUT_MS;
    const call = await ports.runtime().dispatcher.start({
      projectId: auth.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      call: { tool: body.tool, params: body.params } as never,
      timeoutMs,
    });
    return c.json({ callId: call.callId }, 200);
  };

  const readCallHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const runtime = ports.runtime();
    const call = await runtime.dispatcher.tryRead(c.req.param("id") ?? "");
    if (!call || call.projectId !== auth.projectId) return c.notFound();
    await requireConversation({ ...auth, conversationId: call.conversationId });

    const answer = await runtime.dispatcher.tryPoll({
      callId: call.callId,
      holdMs: CALL_POLL_HOLD_MS,
      signal: c.req.raw.signal,
    });
    if (!answer) return c.notFound();
    return c.json(answer, 200);
  };

  const cancelCallHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const runtime = ports.runtime();
    const call = await runtime.dispatcher.tryRead(c.req.param("id") ?? "");
    if (!call || call.projectId !== auth.projectId) return c.notFound();
    await requireConversation({ ...auth, conversationId: call.conversationId });

    await runtime.dispatcher.tryCancel({ callId: call.callId });
    await runtime.waits.cancelTurn({
      conversationId: call.conversationId,
      turnId: call.turnId,
    });
    return c.json({ callId: call.callId, cancelled: true }, 200);
  };

  // ── the question the worker asks ──────────────────────────────────────────

  const startWaitHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const body = await parseBody(c, langyLocalStartWaitRequestSchema);
    await requireConversation({ ...auth, conversationId: body.conversationId });

    const wait = await ports.runtime().waits.startQuestion({
      projectId: auth.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      questions: body.questions,
    });
    return c.json({ waitId: wait.waitId }, 200);
  };

  const readWaitHandler = async (c: ServiceContext<EndpointVariables>) => {
    const auth = await authorize(c);
    const runtime = ports.runtime();
    const wait = await runtime.waits.tryRead(c.req.param("id") ?? "");
    if (!wait || wait.projectId !== auth.projectId) return c.notFound();
    await requireConversation({ ...auth, conversationId: wait.conversationId });

    const answer = await runtime.waits.tryPoll({
      waitId: wait.waitId,
      holdMs: CALL_POLL_HOLD_MS,
      signal: c.req.raw.signal,
    });
    if (!answer) return c.notFound();
    return c.json(answer, 200);
  };

  return restService
    .registerRoute("get", "/local/workspace", MANAGEMENT_API_VERSION, workspaceHandler, (b) =>
      localDoor(b).withRawResponse(
        "the code access card's own status document, as the command line reads it",
      ),
    )
    .registerRoute("post", "/local/requests", MANAGEMENT_API_VERSION, createRequestHandler, (b) =>
      localDoor(b)
        .withMiddleware(bodyLimit({ maxSize: MAX_BODY_BYTES }))
        .withRawResponse("the recorded request and the command that approves it"),
    )
    .registerRoute("post", "/local/calls", MANAGEMENT_API_VERSION, startCallHandler, (b) =>
      localDoor(b)
        .withMiddleware(bodyLimit({ maxSize: MAX_BODY_BYTES }))
        .withRawResponse("the started call's own id"),
    )
    .registerRoute("get", "/local/calls/:id", MANAGEMENT_API_VERSION, readCallHandler, (b) =>
      localDoor(b)
        .withParams(langyLocalCallIdParamsSchema)
        .withRawResponse("the call's answer, or Hono's own 404 while it is still running"),
    )
    .registerRoute(
      "post",
      "/local/calls/:id/cancel",
      MANAGEMENT_API_VERSION,
      cancelCallHandler,
      (b) =>
        localDoor(b).withParams(langyLocalCallIdParamsSchema).withRawResponse("the cancelled call's own id"),
    )
    .registerRoute("post", "/waits", MANAGEMENT_API_VERSION, startWaitHandler, (b) =>
      localDoor(b)
        .withMiddleware(bodyLimit({ maxSize: MAX_BODY_BYTES }))
        .withRawResponse("the started wait's own id"),
    )
    .registerRoute("get", "/waits/:id", MANAGEMENT_API_VERSION, readWaitHandler, (b) =>
      localDoor(b)
        .withParams(langyLocalCallIdParamsSchema)
        .withRawResponse("the answered question, or Hono's own 404 while it is still waiting"),
    )
    .build();
}
