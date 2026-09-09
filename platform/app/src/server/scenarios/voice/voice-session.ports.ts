/**
 * The real {@link VoiceSessionPorts} the "Talk to it" route runs against in
 * production.
 *
 * This is the only module in the voice-session flow allowed to touch
 * `prisma` (via `AgentService`/`ScenarioService`) — the route itself stays
 * HTTP-only (session auth, permission probe, zod validation, the feature-flag
 * gate) and calls `mintVoiceSession`/`finishVoiceSession` with the ports this
 * module composes. See `dev/docs/best_practices/error-handling.md` and
 * `platform/app/CLAUDE.md` ("Hono routes calling repositories directly").
 */

import { nanoid } from "nanoid";
import type { PrismaClient, Scenario } from "~/generated/prisma/client";
import type { CreateAgentInput } from "~/server/agents/agent.repository";
import { AgentService } from "~/server/agents/agent.service";
import type { AgentWithFields } from "~/server/agents/agent-fields";
import {
  parseVoiceAgentConfig,
  VOICE_TRANSPORT_PROVIDER,
} from "~/server/agents/voice/voice-agent.config";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import {
  findElevenLabsProviderForProject,
  getElevenLabsApiCredential,
} from "~/server/gateway/elevenLabsCredential.service";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { writeVoiceCallRun } from "./voice-run-writer";
import type { VoiceSessionPorts } from "./voice-session.service";
import { signVoiceSessionToken } from "./voice-session-token";
import type { VoiceTransportCredential } from "./voice-transport.registry";

/**
 * The narrow slice of `AgentService`/`ScenarioService` the ports need — just
 * enough to compose against in-memory fakes in a unit test, with no Prisma in
 * the loop.
 */
export interface VoiceSessionServices {
  agentService: {
    getById(input: {
      id: string;
      projectId: string;
    }): Promise<AgentWithFields | null>;
    create(input: CreateAgentInput): Promise<AgentWithFields>;
  };
  scenarioService: {
    getById(input: { id: string; projectId: string }): Promise<Scenario | null>;
  };
}

/**
 * Compose the ports from already-built services. Split out from
 * {@link createVoiceSessionPorts} so a unit test can pass in-memory fakes for
 * `agentService`/`scenarioService` instead of a Prisma-backed pair.
 */
export function createVoiceSessionPortsFromServices({
  agentService,
  scenarioService,
}: VoiceSessionServices): VoiceSessionPorts {
  return {
    /** Resolve the provider credential for a transport. Only ElevenLabs
     *  today; a new transport adds a branch here, not a change to the
     *  service. */
    async resolveCredential({
      projectId,
      transport,
    }): Promise<VoiceTransportCredential | null> {
      if (VOICE_TRANSPORT_PROVIDER[transport] !== "elevenlabs") return null;
      const provider = await findElevenLabsProviderForProject({ projectId });
      if (!provider) return null;
      return getElevenLabsApiCredential({ modelProviderId: provider.id });
    },

    /** Looks up the vendor agent id off a saved voice agent row: when a mint
     *  names a row, its stored id wins over anything the request body claims
     *  (AC13/AC29). Null when the row does not exist in the project or is
     *  not a voice agent. */
    async resolveVoiceAgentRow({ projectId, agentRowId }) {
      const agent = await agentService.getById({ id: agentRowId, projectId });
      if (agent?.type !== "voice") return null;
      const config = parseVoiceAgentConfig(agent.config);
      return { id: agent.id, agentExternalId: config.agentId };
    },

    async findExistingRun({ projectId, scenarioRunId }) {
      const run = await getApp().simulations.runs.getScenarioRunData({
        projectId,
        scenarioRunId,
      });
      if (!run) return null;
      const agentId = (run.metadata as { agentId?: unknown } | undefined)
        ?.agentId;
      // The status decides whether a retried finish short-circuits (terminal)
      // or re-drives a half-written run (non-terminal, #7973).
      return {
        agentId: typeof agentId === "string" ? agentId : null,
        status: run.status,
      };
    },

    async createVoiceAgent({ projectId, name, transport, agentId }) {
      const created = await agentService.create({
        id: `agent_${nanoid()}`,
        projectId,
        name,
        type: "voice",
        config: { transport, agentId },
      });
      return { id: created.id };
    },

    writeCallRun: writeVoiceCallRun,

    // A "Call it myself" run lands in the set the scenario's runs live in:
    // the scenario's test-suite set when it is filed in one, else the
    // project's on-platform set. This is the listing its simulated runs
    // share.
    async resolveScenarioSet({ projectId, scenarioId }) {
      const scenario = await scenarioService.getById({
        id: scenarioId,
        projectId,
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
    signSessionToken: (payload) => signVoiceSessionToken({ payload }),
    now: () => Date.now(),
    newSessionId: () => nanoid(),
  };
}

/** Compose the real ports the voice-session service runs against. */
export function createVoiceSessionPorts(
  prismaClient: PrismaClient,
): VoiceSessionPorts {
  return createVoiceSessionPortsFromServices({
    agentService: AgentService.create(prismaClient),
    scenarioService: ScenarioService.create(prismaClient),
  });
}

/** The real ports the route runs against in production. */
export const voiceSessionPorts = createVoiceSessionPorts(prisma);
