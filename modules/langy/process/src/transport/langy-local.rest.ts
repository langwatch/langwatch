/**
 * The worker's door onto the developer's folder (ADR-129), deliberately NOT
 * under `/api/internal`. Every refusal is a `HandledError`: the worker's
 * stderr is `/dev/null`, so the HTTP answer is all it has.
 */

import { PayloadTooLargeError } from "@langwatch/api";
import {
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  CALL_POLL_HOLD_MS,
  createControlRequestResponseSchema,
  LangyApi,
  LangyApiIdentityDeniedError,
  type LangyConversationDetail,
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
  SHARE_CONTROL_COMMAND,
  workspaceStatusSchema,
  langyLocalCallIdParamsSchema,
  langyLocalCreateRequestBodySchema,
  langyLocalStartCallRequestSchema,
  langyLocalStartWaitRequestSchema,
  langyLocalWorkspaceQuerySchema,
} from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { LocalControlRuntime } from "#repositories/redis/redis.langy-local-control-runtime.repository";
import type { ControlSkipGate } from "#rules/langy-local-session-contract.rules";
import { conversationTitle, conversationUrl } from "#rules/langy-local-session-text.rules";
import { reconcileSkipPolicy } from "#rules/langy-local-skip-policy.rules";
import { LangyKeyIdentityService } from "#services/langy-key-identity.service";
import { ControlRequestService } from "#services/langy-local-control-request.service";

import type { UserWaitEvents } from "../rules/langy-local-user-wait-record.rules.ts";

/** A local call is a small JSON document, never an upload. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * The permission this door declares AND the one it enforces. One constant, so
 * the declaration the OpenAPI surface publishes and the check the framework
 * runs cannot drift into disagreeing about what a caller needs.
 */
const LOCAL_PERMISSION = "langy:create" as const;

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

/**
 * Everything the local surface reaches that neither `LangyApi` nor the
 * framework's project door supplies: the flag store, local-control
 * runtime, and code-access sources. Credential and `langy:create` are the door's job now.
 */
export type LangyLocalRestMembers = Readonly<{
  /** This deployment's flag store, for the identity bridge. */
  featureFlags: () => FeatureFlagApi;
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

/** What the process supplies this family beyond `LangyApi` and its own door. */
export const langyLocalRestMembers = defineRestMiddleware(
  "langyLocalRestMembers",
  z.custom<LangyLocalRestMembers>(),
);

/**
 * The door already authenticated the key and enforced `langy:create` as its
 * ceiling; this is the identity bridge on top - the owning user, proved
 * against the deployment's own Langy access decision.
 */
async function resolveLocalCaller(input: {
  request: Request;
  members: LangyLocalRestMembers;
}): Promise<{
  userId: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
}> {
  const resolved = projectCredentialOfRequest(input.request);
  const identity = await LangyKeyIdentityService.create({
    featureFlags: input.members.featureFlags(),
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
}

/**
 * The conversation the caller named, proved against the key: it must be the key's own
 * person's. A teammate's shared conversation gets the not-found a foreign id gets.
 * @see specs/langy/langy-local-permissions.feature
 */
async function conversation(input: {
  app: LangyApi;
  conversationId: string;
  projectId: string;
  userId: string;
}): Promise<LangyConversationDetail> {
  const conversation = await input.app.findByIdVisible({
    id: input.conversationId,
    projectId: input.projectId,
    userId: input.userId,
  });
  if (!conversation?.isOwn) throw new LangyConversationNotFoundError(input.conversationId);
  return conversation;
}

/** Hono's own 404, byte-for-byte what an unmounted path returns. */
const notFoundAnswer = (): Response => new Response("404 Not Found", { status: 404 });

/** Parses and validates a JSON body a composed schema can't declare via `.withInput()`. */
function parseJsonBody<T extends z.ZodType>(raw: string, schema: T): z.infer<T> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new LangyApiRequestInvalidError(parsed.error.issues);
  return parsed.data;
}

export const langyLocalRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: false })

  // ── what `code_access` reads ──────────────────────────────────────────────

  .get("/api/langy/local/workspace", "langyLocalWorkspace")
  .withPermission(LOCAL_PERMISSION)
  .withQuery(langyLocalWorkspaceQuerySchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({
    description: "The code access card's own status document, as the command line reads it.",
  })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, input, request }, members) => {
    const auth = await resolveLocalCaller({ request, members });
    const conversationId = input.conversationId ?? "";
    await conversation({ app, conversationId, projectId: auth.projectId, userId: auth.userId });

    const runtime = members.runtime();
    const connected = await runtime.presence.read(conversationId);
    const pendingRequest = await runtime.requests.tryFindOpenForConversation({
      projectId: auth.projectId,
      userId: auth.userId,
      conversationId,
    });
    const preference = await members.users().tryReadPreference(auth.userId);
    const github = await members.github().readInstallation(auth.projectId);

    return Response.json(
      workspaceStatusSchema.parse({
        connected: connected !== null,
        ...(connected ? { workspace: connected.workspace } : {}),
        codeAccessPreference: preference === "github" ? "github" : null,
        github,
        ...(pendingRequest ? { pendingRequest: ControlRequestService.toWire(pendingRequest) } : {}),
      }),
      { status: 200 },
    );
  })

  // ── the control request the card renders ──────────────────────────────────

  .post("/api/langy/local/requests", "langyLocalCreateRequest")
  .withPermission(LOCAL_PERMISSION)
  .withInput(langyLocalCreateRequestBodySchema)
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "The recorded request and the command that approves it." })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, input, request }, members) => {
    const auth = await resolveLocalCaller({ request, members });
    const resolvedConversation = await conversation({
      app,
      conversationId: input.conversationId,
      projectId: auth.projectId,
      userId: auth.userId,
    });

    const localRequest = await members.runtime().requests.create({
      projectId: auth.projectId,
      projectName: auth.projectName,
      userId: auth.userId,
      conversationId: resolvedConversation.id,
      conversationTitle: conversationTitle(resolvedConversation.title),
      conversationUrl: conversationUrl(resolvedConversation.id, members.baseHost, auth.projectSlug),
    });
    await members.commands().requestLocalControl({
      tenantId: auth.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: resolvedConversation.id,
      requestId: localRequest.id,
      userId: auth.userId,
      expiresAt: localRequest.expiresAt,
      command: SHARE_CONTROL_COMMAND,
    });

    return Response.json(
      createControlRequestResponseSchema.parse({
        request: ControlRequestService.toWire(localRequest),
        command: SHARE_CONTROL_COMMAND,
      }),
      { status: 200 },
    );
  })

  // ── one local tool call ───────────────────────────────────────────────────

  .post("/api/langy/local/calls", "langyLocalStartCall")
  .withPermission(LOCAL_PERMISSION)
  // `langyLocalStartCallRequestSchema` intersects a discriminated union, which
  // `.withInput()`'s `SourceSchema` does not admit; parsed by hand instead,
  // exactly as this route always has.
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "The started call's own id." })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, raw, request }, members) => {
    const body = parseJsonBody(raw, langyLocalStartCallRequestSchema);
    const auth = await resolveLocalCaller({ request, members });
    const resolvedConversation = await conversation({
      app,
      conversationId: body.conversationId,
      projectId: auth.projectId,
      userId: auth.userId,
    });

    // The skip choice is answered by the model the conversation runs on, and
    // that model can change between two calls, so it is re-read here: the
    // command that would have run without a card asks again.
    await reconcileSkipPolicy({
      runtime: members.runtime(),
      projectId: auth.projectId,
      conversationId: body.conversationId,
      model: resolvedConversation.lastModel,
      skipGate: members.skipGate,
      changePolicy: async (args) => {
        await members.commands().changeLocalPolicy({
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
    const call = await members.runtime().dispatcher.start({
      projectId: auth.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      call: { tool: body.tool, params: body.params } as never,
      timeoutMs,
    });
    return Response.json({ callId: call.callId }, { status: 200 });
  })

  .get("/api/langy/local/calls/:id", "langyLocalReadCall")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "The call's answer, or a plain 404 while it is still running." })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, input, request, signal }, members) => {
    const auth = await resolveLocalCaller({ request, members });
    const runtime = members.runtime();
    const call = await runtime.dispatcher.read(input.id);
    if (!call || call.projectId !== auth.projectId) return notFoundAnswer();
    await conversation({
      app,
      conversationId: call.conversationId,
      projectId: auth.projectId,
      userId: auth.userId,
    });

    const answer = await runtime.dispatcher.tryPoll({
      callId: call.callId,
      holdMs: CALL_POLL_HOLD_MS,
      signal,
    });
    if (!answer) return notFoundAnswer();
    return Response.json(answer, { status: 200 });
  })

  .post("/api/langy/local/calls/:id/cancel", "langyLocalCancelCall")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "The cancelled call's own id." })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, input, request }, members) => {
    const auth = await resolveLocalCaller({ request, members });
    const runtime = members.runtime();
    const call = await runtime.dispatcher.read(input.id);
    if (!call || call.projectId !== auth.projectId) return notFoundAnswer();
    await conversation({
      app,
      conversationId: call.conversationId,
      projectId: auth.projectId,
      userId: auth.userId,
    });

    await runtime.dispatcher.tryCancel({ callId: call.callId });
    await runtime.waits.cancelTurn({
      conversationId: call.conversationId,
      turnId: call.turnId,
    });
    return Response.json({ callId: call.callId, cancelled: true }, { status: 200 });
  })

  // ── the question the worker asks ──────────────────────────────────────────

  .post("/api/langy/waits", "langyLocalStartWait")
  .withPermission(LOCAL_PERMISSION)
  // Same composed-schema reason as `/local/calls` above.
  .withRawBody("text")
  .withBodyLimit({ maxBytes: MAX_BODY_BYTES, onExceeded: () => new PayloadTooLargeError() })
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "The started wait's own id." })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, raw, request }, members) => {
    const body = parseJsonBody(raw, langyLocalStartWaitRequestSchema);
    const auth = await resolveLocalCaller({ request, members });
    await conversation({
      app,
      conversationId: body.conversationId,
      projectId: auth.projectId,
      userId: auth.userId,
    });

    const wait = await members.runtime().waits.startQuestion({
      projectId: auth.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      questions: body.questions,
    });
    return Response.json({ waitId: wait.waitId }, { status: 200 });
  })

  .get("/api/langy/waits/:id", "langyLocalReadWait")
  .withPermission(LOCAL_PERMISSION)
  .withParams(langyLocalCallIdParamsSchema)
  .withRawResponse({ produces: "application/json" })
  .withDocs({ description: "The answered question, or a plain 404 while it is still waiting." })
  .withMiddleware(langyLocalRestMembers)
  .handle(async ({ app, input, request, signal }, members) => {
    const auth = await resolveLocalCaller({ request, members });
    const runtime = members.runtime();
    const wait = await runtime.waits.read(input.id);
    if (!wait || wait.projectId !== auth.projectId) return notFoundAnswer();
    await conversation({
      app,
      conversationId: wait.conversationId,
      projectId: auth.projectId,
      userId: auth.userId,
    });

    const answer = await runtime.waits.tryPoll({
      waitId: wait.waitId,
      holdMs: CALL_POLL_HOLD_MS,
      signal,
    });
    if (!answer) return notFoundAnswer();
    return Response.json(answer, { status: 200 });
  })

  .build();
