/**
 * Production {@link VoiceSessionInfrastructure} for "Talk to it" route. Route stays
 * HTTP-only; infrastructure composes from arguments. All collaborators testable
 * against in-memory fakes.
 */

import { generate } from "@langwatch/ksuid";
import type {
  CallRecord,
  SimulationService,
  VoiceSessionInfrastructure,
} from "@langwatch/scenario-contract";
import {
  getOnPlatformSetId,
  parseVoiceAgentConfig,
  VOICE_TRANSPORT_PROVIDER,
  voiceAgentExternalId,
} from "@langwatch/scenario-contract";
import {
  type VoiceTransport,
  type VoiceTransportRunner,
  VoiceAgentRowNotFoundError,
  VoiceKeyMissingError,
} from "@langwatch/scenario-contract/voice-runtime";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { nowInstant } from "@langwatch/time";

/**
 * The narrow slice of the Agent, Scenario, Gateway and Simulation surfaces the
 * infrastructure needs — just enough to compose against in-memory fakes in a
 * unit test, with no persistence in the loop.
 */
export interface VoiceSessionServices {
  agentService: {
    /** Throws `agent_not_found` when the project has no such agent. */
    getById(input: {
      id: string;
      projectId: string;
    }): Promise<{ id: string; type: string; config: unknown }>;
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
    /** Throws `scenario_not_found` when the project has no such scenario. */
    getById(input: { id: string; projectId: string }): Promise<{ testSuiteId: string | null }>;
  };
  /** The project's ElevenLabs key and host, or null when it has none
   *  configured. Owned by the Gateway feature; handed in as one read so this
   *  package never depends on that module's server package. */
  elevenLabsCredentials: {
    resolveForProject(input: {
      projectId: string;
    }): Promise<{ apiKey: string; baseUrl: string } | null>;
  };
  /** The run read a retried finish checks against. */
  simulations: Pick<SimulationService, "findScenarioRunData">;
  /** Records one trace per exchange — `createVoiceCallTraceRecorder`. */
  recordCallTraces: VoiceSessionInfrastructure["recordCallTraces"];
  /** Writes the finished call down as a run — `createVoiceCallRunWriter`. */
  writeCallRun: VoiceSessionInfrastructure["writeCallRun"];
  /** Signs the claims a browser carries from mint to finish. The deployment's
   *  secret is resolved once, at composition, and travels as a value. */
  signSessionToken: VoiceSessionInfrastructure["signSessionToken"];
  /** The voice transports by vendor, built with environment drilled in. */
  registry: Record<VoiceTransport, VoiceTransportRunner>;
}

/** The terminal-retry fields a finished run persisted, narrowed from the loose
 *  run metadata to the shapes {@link VoiceSessionInfrastructure.findExistingRun}
 *  promises. The persisted audioUrl is already the same-origin proxy url the
 *  transport wrote (getCallRecord sets it from audioProxyUrl), so it is kept
 *  as-is. */
function narrowPersistedRunFields(rawMetadata: unknown): {
  agentId: string | null;
  source: CallRecord["source"] | null;
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

function createCredentialReader(
  credentials: VoiceSessionServices["elevenLabsCredentials"],
  registry: VoiceSessionServices["registry"],
): VoiceSessionInfrastructure["getCredential"] {
  return async ({ projectId, transport }) => {
    const credential =
      VOICE_TRANSPORT_PROVIDER[transport] === "elevenlabs"
        ? await credentials.resolveForProject({ projectId })
        : null;
    if (!credential) throw new VoiceKeyMissingError(registry[transport].missingKeyMessage);
    return { kind: "elevenlabs", ...credential };
  };
}

/**
 * Compose the infrastructure from already-built collaborators. Every
 * production caller goes through the module's composition, which supplies the
 * Prisma-backed services; a unit test supplies in-memory fakes instead.
 */
export function createVoiceSessionInfrastructureFromServices({
  agentService,
  scenarioService,
  elevenLabsCredentials,
  simulations,
  recordCallTraces,
  writeCallRun,
  signSessionToken,
  registry,
}: VoiceSessionServices): VoiceSessionInfrastructure {
  return {
    /** Resolve the provider credential for a transport. Only ElevenLabs
     *  today; a new transport adds a branch here, not a change to the
     *  service. */
    getCredential: createCredentialReader(elevenLabsCredentials, registry),

    /** Looks up the vendor agent id off a saved voice agent row: when a mint
     *  names a row, its stored id wins over anything the request body claims
     *  (AC13/AC29). Throws `agent_not_found` when the row does not exist in
     *  the project or is not a voice agent. */
    async getVoiceAgentRow({ projectId, agentRowId }) {
      const agent = await agentService.getById({ id: agentRowId, projectId });
      if (agent.type !== "voice") throw new VoiceAgentRowNotFoundError();
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
      const run = await simulations.findScenarioRunData({
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
        scenarioSetId: typeof run.scenarioSetId === "string" ? run.scenarioSetId : null,
      };
    },

    async createVoiceAgent({ projectId, name, transport, agentId }) {
      // Deduped by identity key inside the service, so a retried finish for a
      // not-yet-saved agent reuses the one row (#8020, decision 1).
      const created = await agentService.createVoiceAgent({
        id: generate("agent").toString(),
        projectId,
        name,
        transport,
        agentId,
      });
      return { id: created.id };
    },

    recordCallTraces,

    writeCallRun,

    // A "Call it myself" run lands in the set the scenario's runs live in:
    // the scenario's test-suite set when it is filed in one, else the
    // project's on-platform set. This is the listing its simulated runs
    // share.
    async getScenarioSet({ projectId, scenarioId }) {
      const scenario = await scenarioService.getById({
        id: scenarioId,
        projectId,
      });
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
    signSessionToken,
    now: () => nowInstant().epochMilliseconds,
    newSessionId: () => generate("scenario").toString(),
    registry,
  };
}
