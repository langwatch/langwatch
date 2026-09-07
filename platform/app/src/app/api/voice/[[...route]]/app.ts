/**
 * Hono app for the browser "Talk to it" flow.
 *
 *   POST /api/voice/session                     — mint a signed-URL session
 *   POST /api/voice/session/:sessionId/finish   — ingest the finished call
 *   GET  /api/voice/session/:conversationId/audio — proxy the recording bytes
 *
 * HTTP concerns only: browser-session auth, project permission, request
 * shaping. The orchestration lives in VoiceSessionService; the vendor coupling
 * lives in the transport. The provider key is read server-side and never
 * crosses to the browser — only the short-lived signed URL and the run ids do.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AgentRepository } from "~/server/agents/agent.repository";
import {
  VOICE_TRANSPORT_PROVIDER,
  VOICE_TRANSPORTS,
  type VoiceTransport,
} from "~/server/agents/voice/voice-agent.config";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import {
  findElevenLabsProviderForProject,
  getElevenLabsApiCredential,
} from "~/server/gateway/elevenLabsCredential.service";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { scenarioRunIdForConversation } from "~/server/scenarios/voice/call-record";
import { voiceCallMaxSeconds } from "~/server/scenarios/voice/voice-limits";
import {
  VoiceAgentNotFoundError,
  writeVoiceCallRun,
} from "~/server/scenarios/voice/voice-run-writer";
import {
  finishVoiceSession,
  mintVoiceSession,
  VoiceConversationMismatchError,
  VoiceKeyMissingError,
  VoiceMintFailedError,
  VoiceNameRequiredError,
  type VoiceSessionPorts,
} from "~/server/scenarios/voice/voice-session.service";
import {
  signVoiceSessionToken,
  verifyVoiceSessionToken,
} from "~/server/scenarios/voice/voice-session-token";
import type { VoiceTransportCredential } from "~/server/scenarios/voice/voice-transport.registry";
import { getSuiteSetId } from "~/server/suites/suite-set-id";

const logger = createLogger("langwatch:api:voice-session");

const secured = createServiceApp({ basePath: "/api/voice" });

const transportSchema = z.enum(
  VOICE_TRANSPORTS as unknown as [VoiceTransport, ...VoiceTransport[]],
);

/** Resolve the provider credential for a transport. Only ElevenLabs today; a
 *  new transport adds a branch here, not a change to the service. */
async function resolveCredential({
  projectId,
  transport,
}: {
  projectId: string;
  transport: VoiceTransport;
}): Promise<VoiceTransportCredential | null> {
  if (VOICE_TRANSPORT_PROVIDER[transport] !== "elevenlabs") return null;
  const provider = await findElevenLabsProviderForProject(projectId);
  if (!provider) return null;
  return getElevenLabsApiCredential({ modelProviderId: provider.id });
}

/** The real ports the service runs against in production. */
const ports: VoiceSessionPorts = {
  resolveCredential,
  async findExistingRun({ projectId, scenarioRunId }) {
    const run = await getApp().simulations.runs.getScenarioRunData({
      projectId,
      scenarioRunId,
    });
    if (!run) return null;
    const agentId = (run.metadata as { agentId?: unknown } | undefined)
      ?.agentId;
    return { agentId: typeof agentId === "string" ? agentId : null };
  },
  async createVoiceAgent({ projectId, name, transport, agentId }) {
    const created = await new AgentRepository(prisma).create({
      id: `agent_${nanoid()}`,
      projectId,
      name,
      type: "voice",
      config: { transport, agentId },
    });
    return { id: created.id };
  },
  writeCallRun: writeVoiceCallRun,
  // A "Call it myself" run lands in the set the scenario's runs live in: the
  // scenario's test-suite set when it is filed in one, else the project's
  // on-platform set. This is the listing its simulated runs share.
  async resolveScenarioSet({ projectId, scenarioId }) {
    const scenario = await new ScenarioRepository(prisma).findById({
      projectId,
      id: scenarioId,
    });
    if (!scenario) return null;
    return {
      scenarioSetId: scenario.testSuiteId
        ? getSuiteSetId(scenario.testSuiteId)
        : getOnPlatformSetId(projectId),
    };
  },
  audioProxyUrl: ({ conversationId, projectId }) =>
    `/api/voice/session/${encodeURIComponent(
      conversationId,
    )}/audio?projectId=${encodeURIComponent(projectId)}`,
  signSessionToken: signVoiceSessionToken,
  now: () => Date.now(),
  newSessionId: () => nanoid(),
};

async function requireProject(
  req: Request,
  projectId: string,
  permission: "scenarios:create" | "scenarios:view",
): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const session = await getServerAuthSession({ req });
  if (!session) return { ok: false, status: 401 };
  const allowed = await probeProjectPermission(
    { session },
    projectId,
    permission,
  );
  if (!allowed) return { ok: false, status: 403 };
  return { ok: true };
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
      const gate = await requireProject(
        c.req.raw,
        projectId,
        "scenarios:create",
      );
      if (!gate.ok) return c.json({ error: "Forbidden" }, gate.status);

      try {
        const result = await mintVoiceSession(ports, {
          projectId,
          transport,
          agentId,
          agentRowId,
          maxDurationSeconds: voiceCallMaxSeconds(),
        });
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof VoiceKeyMissingError) {
          return c.json({ code: error.code, message: error.message }, 400);
        }
        if (error instanceof VoiceMintFailedError) {
          logger.warn({ projectId, agentId, err: error }, "voice mint failed");
          return c.json({ code: error.code, message: error.message }, 400);
        }
        throw error;
      }
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
      const gate = await requireProject(
        c.req.raw,
        body.projectId,
        "scenarios:create",
      );
      if (!gate.ok) return c.json({ error: "Forbidden" }, gate.status);

      // The token must verify, and its project must be the authorised one, or
      // the finish is refused before anything is read or written.
      const token = verifyVoiceSessionToken(body.sessionToken, Date.now());
      if (!token || token.projectId !== body.projectId) {
        return c.json(
          {
            code: "voice_session_invalid",
            message: "The session is invalid or has expired",
          },
          400,
        );
      }

      try {
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
      } catch (error) {
        if (
          error instanceof VoiceNameRequiredError ||
          error instanceof VoiceConversationMismatchError
        ) {
          return c.json({ code: error.code, message: error.message }, 400);
        }
        if (error instanceof VoiceAgentNotFoundError) {
          return c.json({ code: error.code, message: error.message }, 404);
        }
        throw error;
      }
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
      const gate = await requireProject(c.req.raw, projectId, "scenarios:view");
      if (!gate.ok) return c.json({ error: "Forbidden" }, gate.status);

      // Only proxy when a run for this conversation exists in the authorised
      // project — otherwise one project could stream another's recording.
      const run = await getApp().simulations.runs.getScenarioRunData({
        projectId,
        scenarioRunId: scenarioRunIdForConversation(conversationId),
      });
      if (!run) return c.json({ error: "Recording unavailable" }, 404);

      // Drawer calls only run on ElevenLabs today.
      const credential = await resolveCredential({
        projectId,
        transport: "elevenlabs_convai",
      });
      if (!credential) return c.json({ error: "No key" }, 404);

      const upstream = await fetch(
        `${credential.baseUrl}/v1/convai/conversations/${encodeURIComponent(
          conversationId,
        )}/audio`,
        { headers: { "xi-api-key": credential.apiKey } },
      );
      if (!upstream.ok || !upstream.body) {
        return c.json({ error: "Recording unavailable" }, 404);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
          "cache-control": "private, max-age=60",
        },
      });
    },
  );

export type VoiceSessionAppType = typeof route;

export const app = secured.hono;
