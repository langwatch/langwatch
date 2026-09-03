/**
 * The worker's door onto the developer's folder and onto the developer
 * themselves (ADR-129).
 *
 * Mounted under `/api/langy/local` and `/api/langy/waits`, beside the turn
 * surface (`langy-api.ts`) and the page-action surface
 * (`langy-ui-actions.ts`), and deliberately NOT under `/api/internal`, which
 * the Helm ingress blocks by default. The credential is the worker's own
 * per-conversation session key, and the conversation in every body is a claim
 * the route proves against that key rather than a fact it takes.
 *
 * The worker's standard error is not a log line: its stderr goes to
 * `/dev/null`, so everything it needs to know about a refusal has to ride the
 * HTTP answer. Every refusal here is therefore a `HandledError` with a code
 * and a customer-safe message, which is also what the model reads as the tool
 * result.
 */

import type { Context } from "hono";
import { z } from "zod";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { extractCredentials } from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getApp } from "~/server/app-layer/app";
import {
  LangyApiCredentialInvalidError,
  LangyApiCredentialMissingError,
  LangyApiIdentityDeniedError,
  LangyApiRequestInvalidError,
  LangyConversationNotFoundError,
} from "~/server/app-layer/langy/errors";
import { resolveLangyKeyIdentity } from "~/server/app-layer/langy/langyApiKeyIdentity";
import { prisma } from "~/server/db";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  CALL_POLL_HOLD_MS,
  SHARE_CONTROL_COMMAND,
} from "~/server/langy-local-control/constants";
import { toControlRequestWire } from "~/server/langy-local-control/control-request.service";
import {
  createControlRequestResponseSchema,
  startCallBodySchema,
  startWaitBodySchema,
  workspaceStatusSchema,
} from "~/server/langy-local-control/http";
import { getLocalControlRuntime } from "~/server/langy-local-control/runtime";
import { conversationUrl } from "~/server/langy-local-control/session.core";
import { reconcileSkipPolicy } from "~/server/langy-local-control/skip-policy";
import { bodyLimit } from "./_lib/body-limit";

const tokenResolver = TokenResolver.create(prisma);

const AUTH_REASON =
  "session key resolved in-handler via TokenResolver, then bridged to the owning user by resolveLangyKeyIdentity; the conversation in the body is proved against that user and project";

/** A local call is a small JSON document, never an upload. */
const MAX_BODY_BYTES = 256 * 1024;

const localAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["langy:create"],
  credential: "apiKey",
});

const secured = createServiceApp({
  basePath: "/api/langy",
  errorEnvelope: "canonical",
});

const conversationBodySchema = z.object({
  conversationId: z.string().min(1),
  turnId: z.string().min(1),
  /** The worker's own tool call, so the card renders where the work is. */
  toolCallId: z.string().min(1).optional(),
});

const startCallRequestSchema = conversationBodySchema.and(startCallBodySchema);
const startWaitRequestSchema = conversationBodySchema.and(startWaitBodySchema);

/**
 * Authenticate the key and resolve the owning user. Mirrors `langy-api.ts`'s
 * `authorizeTurn`; the permission ceiling is the key's own, which a Langy
 * session key holds by construction.
 */
async function authorize(c: Context) {
  const credentials = extractCredentials((name) => c.req.header(name));
  if (!credentials) throw new LangyApiCredentialMissingError();

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    ...(credentials.projectId ? { projectId: credentials.projectId } : {}),
  });
  if (!resolved) throw new LangyApiCredentialInvalidError();

  const identity = await resolveLangyKeyIdentity({ resolved });
  if (!identity.ok) {
    throw new LangyApiIdentityDeniedError(
      identity.reason === "unowned"
        ? "langy_api_key_unowned"
        : "langy_api_key_no_langy_access",
      identity.message,
    );
  }
  return {
    userId: identity.userId,
    projectId: resolved.project.id,
    projectName: resolved.project.name,
  };
}

/**
 * The conversation the caller named, proved against the key.
 *
 * A conversation the key's user cannot see dies as not-found rather than as a
 * refusal, so a foreign id never confirms that it exists.
 */
async function requireConversation({
  conversationId,
  projectId,
  userId,
}: {
  conversationId: string;
  projectId: string;
  userId: string;
}) {
  const conversation = await getApp().langy.conversations.findByIdVisible({
    id: conversationId,
    projectId,
    userId,
  });
  if (!conversation) throw new LangyConversationNotFoundError(conversationId);
  return conversation;
}

async function parseBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new LangyApiRequestInvalidError(parsed.error.issues);
  }
  return parsed.data;
}

// ── what `code_access` reads ────────────────────────────────────────────────

secured.access(localAuth).get("/local/workspace", async (c) => {
  const auth = await authorize(c);
  const conversationId = c.req.query("conversationId") ?? "";
  await requireConversation({ ...auth, conversationId });

  const runtime = getLocalControlRuntime();
  const connected = await runtime.presence.read(conversationId);
  const pendingRequest = await runtime.requests.findOpenForConversation({
    projectId: auth.projectId,
    userId: auth.userId,
    conversationId,
  });
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { langyCodeAccessPreference: true },
  });
  const github = await readGithubInstallation(auth.projectId);

  return c.json(
    workspaceStatusSchema.parse({
      connected: connected !== null,
      ...(connected ? { workspace: connected.workspace } : {}),
      codeAccessPreference:
        user?.langyCodeAccessPreference === "github" ? "github" : null,
      github,
      ...(pendingRequest
        ? { pendingRequest: toControlRequestWire(pendingRequest) }
        : {}),
    }),
    200,
  );
});

// ── the control request the card renders ────────────────────────────────────

secured
  .access(localAuth)
  .post(
    "/local/requests",
    bodyLimit({ maxSize: MAX_BODY_BYTES }),
    async (c) => {
      const auth = await authorize(c);
      const body = await parseBody(
        c,
        z.object({ conversationId: z.string().min(1) }),
      );
      const conversation = await requireConversation({
        ...auth,
        conversationId: body.conversationId,
      });

      const runtime = getLocalControlRuntime();
      const request = await runtime.requests.create({
        projectId: auth.projectId,
        projectName: auth.projectName,
        userId: auth.userId,
        conversationId: conversation.id,
        conversationTitle: conversation.title ?? "Langy",
        conversationUrl: conversationUrl(conversation.id),
      });
      await getApp().commands.langy.requestLocalControl({
        tenantId: auth.projectId,
        occurredAt: Date.now(),
        conversationId: conversation.id,
        requestId: request.id,
        userId: auth.userId,
        expiresAt: request.expiresAt,
        command: SHARE_CONTROL_COMMAND,
      });

      return c.json(
        createControlRequestResponseSchema.parse({
          request: toControlRequestWire(request),
          command: SHARE_CONTROL_COMMAND,
        }),
        200,
      );
    },
  );

// ── one local tool call ─────────────────────────────────────────────────────

secured
  .access(localAuth)
  .post("/local/calls", bodyLimit({ maxSize: MAX_BODY_BYTES }), async (c) => {
    const auth = await authorize(c);
    const body = await parseBody(c, startCallRequestSchema);
    const conversation = await requireConversation({
      ...auth,
      conversationId: body.conversationId,
    });

    // The skip choice is answered by the model the conversation runs on, and
    // that model can change between two calls, so it is re-read here: the
    // command that would have run without a card asks again.
    await reconcileSkipPolicy({
      runtime: getLocalControlRuntime(),
      projectId: auth.projectId,
      conversationId: body.conversationId,
      model: conversation.lastModel,
    });

    const timeoutMs =
      body.tool === "local_bash" && body.params.timeout
        ? body.params.timeout * 1000
        : BASH_DEFAULT_TIMEOUT_MS;
    const call = await getLocalControlRuntime().dispatcher.start({
      projectId: auth.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      call: { tool: body.tool, params: body.params } as never,
      timeoutMs,
    });
    return c.json({ callId: call.callId }, 200);
  });

secured.access(localAuth).get("/local/calls/:id", async (c) => {
  const auth = await authorize(c);
  const runtime = getLocalControlRuntime();
  const call = await runtime.dispatcher.read(c.req.param("id"));
  if (!call || call.projectId !== auth.projectId) return c.notFound();
  await requireConversation({ ...auth, conversationId: call.conversationId });

  const answer = await runtime.dispatcher.poll({
    callId: call.callId,
    holdMs: CALL_POLL_HOLD_MS,
    signal: c.req.raw.signal,
  });
  if (!answer) return c.notFound();
  return c.json(answer, 200);
});

secured.access(localAuth).post("/local/calls/:id/cancel", async (c) => {
  const auth = await authorize(c);
  const runtime = getLocalControlRuntime();
  const call = await runtime.dispatcher.read(c.req.param("id"));
  if (!call || call.projectId !== auth.projectId) return c.notFound();
  await requireConversation({ ...auth, conversationId: call.conversationId });

  await runtime.dispatcher.cancel({ callId: call.callId });
  await runtime.waits.cancelTurn({
    conversationId: call.conversationId,
    turnId: call.turnId,
  });
  return c.json({ callId: call.callId, cancelled: true }, 200);
});

// ── the question the worker asks ────────────────────────────────────────────

secured
  .access(localAuth)
  .post("/waits", bodyLimit({ maxSize: MAX_BODY_BYTES }), async (c) => {
    const auth = await authorize(c);
    const body = await parseBody(c, startWaitRequestSchema);
    await requireConversation({ ...auth, conversationId: body.conversationId });

    const wait = await getLocalControlRuntime().waits.startQuestion({
      projectId: auth.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      questions: body.questions,
    });
    return c.json({ waitId: wait.waitId }, 200);
  });

secured.access(localAuth).get("/waits/:id", async (c) => {
  const auth = await authorize(c);
  const runtime = getLocalControlRuntime();
  const wait = await runtime.waits.read(c.req.param("id"));
  if (!wait || wait.projectId !== auth.projectId) return c.notFound();
  await requireConversation({ ...auth, conversationId: wait.conversationId });

  const answer = await runtime.waits.poll({
    waitId: wait.waitId,
    holdMs: CALL_POLL_HOLD_MS,
    signal: c.req.raw.signal,
  });
  if (!answer) return c.notFound();
  return c.json(answer, 200);
});

/**
 * Whether the organization installed the GitHub App, for the GitHub half of
 * the code access card. A service that is not configured answers "not
 * installed", which is the state the card should show anyway.
 */
async function readGithubInstallation(
  projectId: string,
): Promise<{ installed: boolean; accountLogin?: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;
  if (!organizationId) return { installed: false };
  const installations =
    await getApp().github.installations.getAllForOrganization(organizationId);
  const usable = installations.filter((row) => row.suspendedAt == null);
  const first = usable[0];
  return first
    ? { installed: true, accountLogin: first.accountLogin }
    : { installed: false };
}

export const app = secured.hono;
