/**
 * Production {@link WholeCallAudioInfrastructure} for run-audio route. Split from
 * service (like voice-session.infrastructure): touches the two reads (run traces,
 * trace spans) so service stays testable against fake reader.
 */

import type { SimulationService, WholeCallAudioInfrastructure } from "@langwatch/scenario-contract";
import type { TraceApi } from "@langwatch/trace-contract";

/** What resolving a call's audio reaches outside itself. */
export interface WholeCallAudioCollaborators {
  /** The run the audio belongs to, read for the trace ids its messages carry. */
  simulations: Pick<SimulationService, "findScenarioRunData">;
  /** One trace's normalized spans, read for the attributes they carry. */
  traces: Pick<TraceApi, "findNormalizedSpansByTraceId">;
}

/** Compose the production infrastructure from the two reads it needs. */
export function createWholeCallAudioInfrastructure(
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
