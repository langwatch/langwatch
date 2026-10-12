/**
 * The real {@link WholeCallAudioPorts} the run-audio route runs against.
 *
 * Split from the resolution service the same way `voice-session.ports.ts` is
 * split from `voice-session.service.ts`: this is the only place the run-audio
 * resolution touches the app's read services (the run's traces, the trace's
 * spans), so the service itself stays testable against a fake reader.
 */

import { internalActor } from "@langwatch/actor";
import { getApp } from "~/server/app-layer/app";
import type { WholeCallAudioPorts } from "./whole-call-audio.service";

/** Compose the production ports from the app's read services. */
export function createWholeCallAudioPorts(): WholeCallAudioPorts {
  return {
    /** The distinct trace ids the run's messages carry, in first-seen order.
     *  A voice run records one trace per exchange, so the whole-call handle a
     *  span carries is reachable from these. */
    async loadRunTraceIds({ projectId, scenarioRunId }) {
      const run = await getApp().simulations.runs.getScenarioRunData({
        projectId,
        scenarioRunId,
      });
      if (!run) return [];
      const traceIds: string[] = [];
      const seen = new Set<string>();
      for (const message of run.messages ?? []) {
        const traceId = message.trace_id;
        if (
          typeof traceId === "string" &&
          traceId.length > 0 &&
          !seen.has(traceId)
        ) {
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
      const app = getApp();
      // The run-audio route admitted the caller on the scenario; the span
      // read is fenced to the run's own project (ADR-144 block C).
      const authorization = await app.authorization.authorizeInternal({
        actor: internalActor("scenarios/voice/whole-call-audio.ports"),
        projectId,
        permission: "traces:view",
        purpose: {
          kind: "operator",
          entry: "WholeCallAudioPorts.readSpanAttributes",
        },
      });
      const spans = await app.traces.spans.getNormalizedSpansByTraceId({
        authorization,
        traceId,
      });
      return spans.map((span) => span.spanAttributes);
    },
  };
}

/** The real ports the route runs against in production. */
export const wholeCallAudioPorts: WholeCallAudioPorts =
  createWholeCallAudioPorts();
