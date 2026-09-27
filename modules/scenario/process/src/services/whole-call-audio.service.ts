// Resolve the handle the whole-call audio player streams a run's recording by.
// Reads run's traces, scans spans for vendor handle (Twilio or ElevenLabs); unavailable if missing.

import {
  VoiceRecordingUnavailableError,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { TraceApi } from "@langwatch/trace-contract";

/** The span attribute a phone run stamps its Twilio call SID on. */
export const TWILIO_CALL_SID_ATTR = "voice.twilio.call_sid";
/** The span attribute an ElevenLabs run stamps its conversation id on. */
export const ELEVENLABS_CONVERSATION_ID_ATTR = "voice.elevenlabs.conversation_id";

/**
 * The vendor handle a run's whole-call audio is fetched by. A discriminated
 * union: a phone run is streamed from a Twilio recording, an ElevenLabs run
 * from the conversation audio, and the two carry materially different ids.
 */
export type WholeCallAudioHandle =
  | { kind: "twilio"; callSid: string }
  | { kind: "elevenlabs"; conversationId: string };

/** The reads the resolution needs, injected so the scan is tested with a fake
 *  span reader rather than a live ClickHouse. */
export interface WholeCallAudioInfrastructure {
  /** The trace ids of this run, in the order the scan should visit them. */
  loadRunTraceIds(input: { projectId: string; scenarioRunId: string }): Promise<readonly string[]>;
  /** The span attribute maps of one trace, one entry per span. */
  readSpanAttributes(input: {
    projectId: string;
    traceId: string;
  }): Promise<readonly Readonly<Record<string, unknown>>[]>;
}

/** A non-empty string attribute, or null. Guards against the empty string a
 *  half-written span can carry, which is not a usable handle. */
function pickStringAttr(attributes: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The handle one span's attributes name, or null. Twilio is checked first: a
 *  phone run carries only the Twilio key, an ElevenLabs run only its own. */
function extractAttributesHandle(
  attributes: Readonly<Record<string, unknown>>,
): WholeCallAudioHandle | null {
  const callSid = pickStringAttr(attributes, TWILIO_CALL_SID_ATTR);
  if (callSid) return { kind: "twilio", callSid };
  const conversationId = pickStringAttr(attributes, ELEVENLABS_CONVERSATION_ID_ATTR);
  if (conversationId) return { kind: "elevenlabs", conversationId };
  return null;
}

/** What resolving a call's audio reaches outside itself. */
export interface WholeCallAudioCollaborators {
  /** The run the audio belongs to, read for the trace ids its messages carry. */
  simulations: Pick<SimulationService, "findScenarioRunData">;
  /** One trace's normalized spans, read for the attributes they carry. */
  traces: Pick<TraceApi, "findNormalizedSpansByTraceId">;
}

/** Compose the production infrastructure from the two reads it needs. */
function createWholeCallAudioInfrastructure(
  collaborators: WholeCallAudioCollaborators,
): WholeCallAudioInfrastructure {
  return {
    /** The distinct trace ids the run's messages carry, in first-seen order.
     *  A voice run records one trace per exchange, so the whole-call handle a
     *  span carries is reachable from these. */
    async loadRunTraceIds({ projectId, scenarioRunId }) {
      const run = await collaborators.simulations.findScenarioRunData({
        projectId,
        scenarioRunId,
      });
      if (!run) return [];
      const traceIds: string[] = [];
      const seen = new Set<string>();
      for (const message of run.messages ?? []) {
        const traceId = message.trace_id;
        if (typeof traceId === "string" && traceId.length > 0 && !seen.has(traceId)) {
          seen.add(traceId);
          traceIds.push(traceId);
        }
      }
      return traceIds;
    },

    /** The span attribute maps of one trace. The whole-call handle is a plain
     *  string span attribute (`voice.twilio.call_sid` /
     *  `voice.elevenlabs.conversation_id`), so the normalized spans' own
     *  attribute records are handed straight to the scan. */
    async readSpanAttributes({ projectId, traceId }) {
      const spans = await collaborators.traces.findNormalizedSpansByTraceId({
        tenantId: projectId,
        traceId,
      });
      return spans.map((span) => span.spanAttributes);
    },
  };
}

/** The whole-call audio handle a run's own trace spans name. */
export class WholeCallAudioService {
  static create(infrastructure: WholeCallAudioInfrastructure): WholeCallAudioService {
    return new WholeCallAudioService(infrastructure);
  }

  /** The production reads: the run's trace ids, then each trace's spans. */
  static infrastructureFrom(
    collaborators: WholeCallAudioCollaborators,
  ): WholeCallAudioInfrastructure {
    return createWholeCallAudioInfrastructure(collaborators);
  }

  private constructor(private readonly infrastructure: WholeCallAudioInfrastructure) {}

  /** Scans the run's traces in order; throws `VoiceRecordingUnavailableError` when none has one. */
  async getHandle({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<WholeCallAudioHandle> {
    const traceIds = await this.infrastructure.loadRunTraceIds({ projectId, scenarioRunId });
    for (const traceId of traceIds) {
      const spans = await this.infrastructure.readSpanAttributes({ projectId, traceId });
      for (const attributes of spans) {
        const handle = extractAttributesHandle(attributes);
        if (handle) return handle;
      }
    }
    throw new VoiceRecordingUnavailableError();
  }
}
