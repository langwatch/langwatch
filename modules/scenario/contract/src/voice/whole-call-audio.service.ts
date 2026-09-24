// Resolve the handle the whole-call audio player streams a run's recording by.
// Reads run's traces, scans spans for vendor handle (Twilio or ElevenLabs), null if missing.

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

/**
 * The whole-call audio handle for a run, resolved from the run's own trace
 * spans, or null when no span names one.
 */
export async function resolveWholeCallAudio({
  projectId,
  scenarioRunId,
  infrastructure,
}: {
  projectId: string;
  scenarioRunId: string;
  infrastructure: WholeCallAudioInfrastructure;
}): Promise<WholeCallAudioHandle | null> {
  const traceIds = await infrastructure.loadRunTraceIds({
    projectId,
    scenarioRunId,
  });
  for (const traceId of traceIds) {
    const spans = await infrastructure.readSpanAttributes({
      projectId,
      traceId,
    });
    for (const attributes of spans) {
      const handle = extractAttributesHandle(attributes);
      if (handle) return handle;
    }
  }
  return null;
}
