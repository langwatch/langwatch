/**
 * The real {@link VoiceSessionInfrastructure} the "Talk to it" route runs against in
 * production.
 *
 * This is the only module in the voice-session flow allowed to touch
 * `prisma` (via `AgentService`/`ScenarioService`) — the route itself stays
 * HTTP-only (session auth, permission probe, zod validation, the feature-flag
 * gate) and calls `mintVoiceSession`/`finishVoiceSession` with the
 * infrastructure this module composes. See
 * `dev/docs/best_practices/error-handling.md` and
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
  type VoiceTransport,
  voiceAgentExternalId,
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
import { recordVoiceCallTraces } from "./voice-call-trace-writer";
import { writeVoiceCallRun } from "./voice-run-writer";
import type { VoiceSessionInfrastructure } from "./voice-session.service";
import { signVoiceSessionToken } from "./voice-session-token";
import type { VoiceTransportCredential } from "./voice-transport.registry";

/**
 * The narrow slice of `AgentService`/`ScenarioService` the infrastructure
 * needs — just enough to compose against in-memory fakes in a unit test, with
 * no Prisma in the loop.
 */
export interface VoiceSessionServices {
  agentService: {
    getById(input: {
      id: string;
      projectId: string;
    }): Promise<AgentWithFields | null>;
    create(input: CreateAgentInput): Promise<AgentWithFields>;
    /** Creates the voice agent row deduped by its identity key, so a retried
     *  finish for a not-yet-saved agent reuses the one row (#8020). */
    createVoiceAgent(input: {
      id: string;
      projectId: string;
      name: string;
      transport: VoiceTransport;
      agentId: string;
    }): Promise<{ id: string }>;
    /** Whether this project saved a voice agent for the given vendor agent id.
     *  Authorizes drawer recording playback, which writes no run (#8020). */
    hasVoiceAgentForExternalId(input: {
      projectId: string;
      transport: VoiceTransport;
      agentExternalId: string;
    }): Promise<boolean>;
  };
  scenarioService: {
    getById(input: { id: string; projectId: string }): Promise<Scenario | null>;
  };
}

/** The terminal-retry fields a finished run persisted, narrowed from the loose
 *  run metadata to the shapes {@link VoiceSessionInfrastructure.findExistingRun}
 *  promises. The persisted audioUrl is already the same-origin proxy url the
 *  transport wrote (fetchCallRecord sets it from audioProxyUrl), so it is kept
 *  as-is. */
function narrowPersistedRunFields(rawMetadata: unknown): {
  agentId: string | null;
  source: "provider" | "browser" | null;
  audioUrl: string | null;
} {
  const metadata = rawMetadata as
    | { agentId?: unknown; source?: unknown; audioUrl?: unknown }
    | undefined;
  const { agentId, source, audioUrl } = metadata ?? {};
  return {
    agentId: typeof agentId === "string" ? agentId : null,
    source: source === "provider" || source === "browser" ? source : null,
    audioUrl: typeof audioUrl === "string" ? audioUrl : null,
  };
}

/**
 * Compose the infrastructure from already-built services. Split out from
 * {@link createVoiceSessionInfrastructure} so a unit test can pass in-memory
 * fakes for `agentService`/`scenarioService` instead of a Prisma-backed pair.
 */
export function createVoiceSessionInfrastructureFromServices({
  agentService,
  scenarioService,
}: VoiceSessionServices): VoiceSessionInfrastructure {
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
      const credential = await getElevenLabsApiCredential({
        modelProviderId: provider.id,
      });
      return credential ? { kind: "elevenlabs", ...credential } : null;
    },

    /** Looks up the vendor agent id off a saved voice agent row: when a mint
     *  names a row, its stored id wins over anything the request body claims
     *  (AC13/AC29). Null when the row does not exist in the project or is
     *  not a voice agent. */
    async resolveVoiceAgentRow({ projectId, agentRowId }) {
      const agent = await agentService.getById({ id: agentRowId, projectId });
      if (agent?.type !== "voice") return null;
      const config = parseVoiceAgentConfig(agent.config);
      return { id: agent.id, agentExternalId: voiceAgentExternalId(config) };
    },

    /** Whether the project saved a voice agent for this vendor agent id: the
     *  provider conversation's agent id is matched to the row a drawer hang-up
     *  created, so its recording plays back without a run to check (#8020). */
    hasVoiceAgentForExternalId({ projectId, transport, agentExternalId }) {
      return agentService.hasVoiceAgentForExternalId({
        projectId,
        transport,
        agentExternalId,
      });
    },

    async findExistingRun({ projectId, scenarioRunId }) {
      const run = await getApp().simulations.runs.getScenarioRunData({
        projectId,
        scenarioRunId,
      });
      if (!run) return null;
      // The status decides whether a retried finish short-circuits (written)
      // or re-drives a half-written run (#7973). The persisted source,
      // recording and set let a terminal retry report the original run's
      // transcript origin, Play control and deep link (AC14).
      return {
        ...narrowPersistedRunFields(run.metadata),
        status: run.status,
        // The scenario and set the run landed under, reused on a re-drive so a
        // scenario archived between attempts cannot break the retry (#7973 AC1).
        scenarioId: typeof run.scenarioId === "string" ? run.scenarioId : null,
        scenarioSetId:
          typeof run.scenarioSetId === "string" ? run.scenarioSetId : null,
      };
    },

    async createVoiceAgent({ projectId, name, transport, agentId }) {
      // Deduped by identity key inside the service, so a retried finish for a
      // not-yet-saved agent reuses the one row (#8020, decision 1).
      const created = await agentService.createVoiceAgent({
        id: `agent_${nanoid()}`,
        projectId,
        name,
        transport,
        agentId,
      });
      return { id: created.id };
    },

    recordCallTraces: recordVoiceCallTraces,

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

/** Compose the real infrastructure the voice-session service runs against. */
export function createVoiceSessionInfrastructure(
  prismaClient: PrismaClient,
): VoiceSessionInfrastructure {
  return createVoiceSessionInfrastructureFromServices({
    agentService: AgentService.create(prismaClient),
    scenarioService: ScenarioService.create(prismaClient),
  });
}

/** The real infrastructure the route runs against in production. */
export const voiceSessionInfrastructure =
  createVoiceSessionInfrastructure(prisma);
