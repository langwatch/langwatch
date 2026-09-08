/**
 * Hono app for the browser "Talk to it" flow.
 *
 *   POST /api/voice/session                     — mint a signed-URL session
 *   POST /api/voice/session/:sessionId/finish   — ingest the finished call
 *   GET  /api/voice/session/:conversationId/audio — proxy the recording bytes
 *
 * HTTP concerns only: browser-session auth, project permission, request
 * shaping, and calling the service with the composed ports
 * ({@link voiceSessionPorts}). The orchestration lives in VoiceSessionService;
 * the vendor coupling lives in the transport. The provider key is read
 * server-side and never crosses to the browser — only the short-lived signed
 * URL and the run ids do.
 *
 * Every domain failure is a `HandledError` thrown by the service (or by
 * {@link requireProject} below) and left to `createServiceApp`'s `onError` to
 * serialise — no route-local `c.json({ error }, status)` and no catch ladder
 * (see `platform/app/CLAUDE.md`, "Hono routes calling repositories directly").
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { z } from "zod";
import {
  VOICE_TRANSPORTS,
  type VoiceTransport,
} from "~/server/agents/voice/voice-agent.config";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { ProjectPermissionDeniedError } from "~/server/app-layer/permissions/errors";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import { isVoiceAgentsEnabledForProject } from "~/server/featureFlag/voiceAgents";
import { scenarioRunIdForConversation } from "~/server/scenarios/voice/call-record";
import {
  VOICE_HTTP_TIMEOUT_MS,
  voiceCallMaxSeconds,
} from "~/server/scenarios/voice/voice-limits";
import { voiceSessionPorts as ports } from "~/server/scenarios/voice/voice-session.ports";
import {
  finishVoiceSession,
  mintVoiceSession,
  VoiceAgentsGateDisabledError,
  VoiceSessionInvalidError,
  VoiceUnauthenticatedError,
} from "~/server/scenarios/voice/voice-session.service";
import { verifyVoiceSessionToken } from "~/server/scenarios/voice/voice-session-token";

const secured = createServiceApp({ basePath: "/api/voice" });

const transportSchema = z.enum(
  VOICE_TRANSPORTS as unknown as [VoiceTransport, ...VoiceTransport[]],
);

/**
 * Session auth, project permission and the product feature flag — everything
 * a request must clear before the service is asked to do anything. Throws
 * rather than returning a body: {@link VoiceUnauthenticatedError} (401),
 * {@link ProjectPermissionDeniedError} (403), or
 * {@link VoiceAgentsGateDisabledError} (404, so a project without the flag
 * reads exactly like the drawer and run dialog do — never a 403 that would
 * leak that the door exists at all, AC29).
 */
async function requireProject(
  req: Request,
  projectId: string,
  permission: "scenarios:create" | "scenarios:view",
): Promise<void> {
  const session = await getServerAuthSession({ req });
  if (!session) throw new VoiceUnauthenticatedError();
  const allowed = await probeProjectPermission(
    { session },
    projectId,
    permission,
  );
  if (!allowed) throw new ProjectPermissionDeniedError(permission);
  const voiceEnabled = await isVoiceAgentsEnabledForProject({ projectId });
  if (!voiceEnabled) throw new VoiceAgentsGateDisabledError();
}

// POST /api/voice/session — mint a signed-URL session from the form values.
secured
  .access(
    handlerManagedAuth({
      reason: "browser session validated in-handler via getServerAuthSession",
      permissions: ["scenarios:create"],
      credential: "session",
    }),
  )
  .post(
    "/session",
    zValidator(
      "json",
      z.object({
        projectId: z.string().min(1),
        transport: transportSchema,
        agentId: z.string().trim().min(1).max(128),
        agentRowId: z.string().min(1).optional(),
      }),
    ),
    async (c) => {
      const { projectId, transport, agentId, agentRowId } = c.req.valid("json");
      await requireProject(c.req.raw, projectId, "scenarios:create");

      const result = await mintVoiceSession(ports, {
        projectId,
        transport,
        agentId,
        agentRowId,
        maxDurationSeconds: voiceCallMaxSeconds(),
      });
      return c.json(result, 200);
    },
  );

// POST /api/voice/session/:sessionId/finish — ingest the finished call.
secured
  .access(
    handlerManagedAuth({
      reason: "browser session validated in-handler via getServerAuthSession",
      permissions: ["scenarios:create"],
      credential: "session",
    }),
  )
  .post(
    "/session/:sessionId/finish",
    zValidator(
      "json",
      z.object({
        projectId: z.string().min(1),
        // The signed session token replaces the bare id and carries the
        // project, transport, agent row and vendor agent id the finish trusts.
        sessionToken: z.string().min(1),
        name: z.string().trim().max(200).optional(),
        conversationId: z.string().trim().max(200).optional(),
        transcript: z
          .array(
            z.object({
              role: z.enum(["caller", "agent"]),
              text: z.string(),
            }),
          )
          .default([]),
        startedAt: z.number(),
        endedAt: z.number(),
        cutAtLimit: z.boolean().default(false),
        // Set for a "Call it myself" run: the scenario the call is written
        // under and scored against (AC23). Absent for a drawer call.
        scenarioId: z.string().trim().min(1).optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      await requireProject(c.req.raw, body.projectId, "scenarios:create");

      // The token must verify, and its project must be the authorised one, or
      // the finish is refused before anything is read or written.
      const token = verifyVoiceSessionToken(body.sessionToken, Date.now());
      if (!token || token.projectId !== body.projectId) {
        throw new VoiceSessionInvalidError();
      }

      const result = await finishVoiceSession(ports, {
        token,
        projectId: body.projectId,
        name: body.name,
        conversationId: body.conversationId,
        transcript: body.transcript,
        startedAt: body.startedAt,
        endedAt: body.endedAt,
        cutAtLimit: body.cutAtLimit,
        scenarioId: body.scenarioId,
      });
      return c.json(result, 200);
    },
  );

// GET /api/voice/session/:conversationId/audio — stream the recording through
// the app so the provider key never reaches the browser (AC13/AC15).
export const route = secured
  .access(
    handlerManagedAuth({
      reason: "browser session validated in-handler via getServerAuthSession",
      permissions: ["scenarios:view"],
      credential: "session",
    }),
  )
  .get(
    "/session/:conversationId/audio",
    zValidator(
      "param",
      z.object({ conversationId: z.string().min(1).max(200) }),
    ),
    zValidator("query", z.object({ projectId: z.string().min(1) })),
    async (c) => {
      const { conversationId } = c.req.valid("param");
      const { projectId } = c.req.valid("query");
      await requireProject(c.req.raw, projectId, "scenarios:view");

      // Only proxy when a run for this conversation exists in the authorised
      // project — otherwise one project could stream another's recording.
      const run = await getApp().simulations.runs.getScenarioRunData({
        projectId,
        scenarioRunId: scenarioRunIdForConversation(conversationId),
      });
      if (!run) return c.json({ error: "Recording unavailable" }, 404);

      // Drawer calls only run on ElevenLabs today.
      const credential = await ports.resolveCredential({
        projectId,
        transport: "elevenlabs_convai",
      });
      if (!credential) return c.json({ error: "No key" }, 404);

      // A timeout on the connect/headers phase only: once the response
      // arrives we stop racing the timeout against the body so a long
      // recording is never cut mid-stream. The caller's own abort (tab
      // closed, request cancelled) still propagates the whole way through.
      const timeoutController = new AbortController();
      const timeout = setTimeout(
        () => timeoutController.abort(),
        VOICE_HTTP_TIMEOUT_MS,
      );
      const onCallerAbort = () => timeoutController.abort();
      c.req.raw.signal.addEventListener("abort", onCallerAbort);

      let upstream: Response;
      try {
        upstream = await fetch(
          `${credential.baseUrl}/v1/convai/conversations/${encodeURIComponent(
            conversationId,
          )}/audio`,
          {
            headers: { "xi-api-key": credential.apiKey },
            signal: timeoutController.signal,
            // A followed redirect would forward the credentialed header to
            // whatever host answered it.
            redirect: "error",
          },
        );
      } catch {
        // A refused redirect, a connect timeout, or a network failure all
        // mean the same thing to the player: no recording to play. Answer
        // 404 rather than letting the rejection surface as a 500.
        return c.json({ error: "Recording unavailable" }, 404);
      } finally {
        clearTimeout(timeout);
        c.req.raw.signal.removeEventListener("abort", onCallerAbort);
      }
      if (!upstream.ok || !upstream.body) {
        return c.json({ error: "Recording unavailable" }, 404);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
          "cache-control": "no-store",
        },
      });
    },
  );

export type VoiceSessionAppType = typeof route;

export const app = secured.hono;
