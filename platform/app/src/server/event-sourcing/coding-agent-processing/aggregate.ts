import { defineAggregate } from "@langwatch/event-sourcing";
import {
  type CodingAgentSessionIdentityState,
  codingAgentSessionIdentityStateSchema,
  initCodingAgentSessionIdentityState,
  type LogFactsContribution,
  logFactsContributionSchema,
  type MetricFactsContribution,
  metricFactsContributionSchema,
  type SpanFactsContribution,
  spanFactsContributionSchema,
} from "./schema";
import {
  applyIdentity,
  applyIdentitySlot,
  applyStartedAtMs,
} from "./sessionIdentity";

/**
 * The `coding_agent_session` aggregate (ADR-105). Identity only: every count
 * is a query over `coding_agent_session_contributions` (ADR-103), and a
 * session's traces are rows in `coding_agent_trace_sessions`.
 *
 * `agent`/`sessionKeySource` share one last-write-wins stamp because every
 * contribution carries both; each sparse slot carries its own, so a
 * contribution missing one never blanks it.
 */

const codingAgentSessionEvents = {
  spanFactsContributed: {
    data: spanFactsContributionSchema,
    apply: (
      state: CodingAgentSessionIdentityState,
      data: SpanFactsContribution,
    ): CodingAgentSessionIdentityState => {
      let next = applyIdentity(state, {
        agent: data.agent,
        sessionKeySource: data.sessionKeySource,
        acceptedAt: data.acceptedAt,
      });
      next = {
        ...next,
        startedAtMs: applyStartedAtMs(next.startedAtMs, data.startTimeUnixMs),
      };
      return next;
    },
  },

  logFactsContributed: {
    data: logFactsContributionSchema,
    apply: (
      state: CodingAgentSessionIdentityState,
      data: LogFactsContribution,
    ): CodingAgentSessionIdentityState => {
      let next = applyIdentity(state, {
        agent: data.agent,
        sessionKeySource: data.sessionKeySource,
        acceptedAt: data.acceptedAt,
      });
      next = {
        ...next,
        startedAtMs: applyStartedAtMs(next.startedAtMs, data.timeUnixMs),
        userId: applyIdentitySlot(
          next.userId,
          readScalarString(data.facts["user.id"]),
          data.acceptedAt,
        ),
        terminalType: applyIdentitySlot(
          next.terminalType,
          readScalarString(data.facts["terminal.type"]),
          data.acceptedAt,
        ),
        entrypoint: applyIdentitySlot(
          next.entrypoint,
          readScalarString(data.facts["app.entrypoint"]),
          data.acceptedAt,
        ),
        agentVersion: applyIdentitySlot(
          next.agentVersion,
          readScalarString(data.facts["app.version"]),
          data.acceptedAt,
        ),
        permissionMode: applyIdentitySlot(
          next.permissionMode,
          readScalarString(data.facts.permission_mode),
          data.acceptedAt,
        ),
        finalRequestId: applyIdentitySlot(
          next.finalRequestId,
          readScalarString(data.facts.request_id),
          data.acceptedAt,
        ),
        stopReason: applyIdentitySlot(
          next.stopReason,
          readScalarString(data.facts.stop_reason),
          data.acceptedAt,
        ),
        truncated: next.truncated || data.facts.truncated === true,
      };
      return next;
    },
  },

  metricFactsContributed: {
    data: metricFactsContributionSchema,
    apply: (
      state: CodingAgentSessionIdentityState,
      data: MetricFactsContribution,
    ): CodingAgentSessionIdentityState => {
      // Metrics carry no trace context and none of the sparse identity
      // facts (`schema.ts`'s `metricFactsContributionSchema` has no
      // `facts` map) — only the universal identity and a value against
      // `startedAtMs`.
      let next = applyIdentity(state, {
        agent: data.agent,
        sessionKeySource: data.sessionKeySource,
        acceptedAt: data.acceptedAt,
      });
      next = {
        ...next,
        startedAtMs: applyStartedAtMs(next.startedAtMs, data.asOfUnixMs),
      };
      return next;
    },
  },
};

/** A present, non-empty string from a lifted scalar fact, or null — never coerces a number/boolean into a string silently. */
function readScalarString(
  value: string | number | boolean | undefined,
): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const codingAgentSession = defineAggregate("coding_agent_session")
  .state(
    codingAgentSessionIdentityStateSchema,
    initCodingAgentSessionIdentityState,
  )
  .events(codingAgentSessionEvents)
  .commands({
    // Session-id resolution and agent detection happen upstream, in
    // `bridge/dispatch.ts`, before a command is ever dispatched.
    contributeSpanFacts: {
      input: spanFactsContributionSchema,
      handle: (_state, input, events) => [events.spanFactsContributed(input)],
    },
    contributeLogFacts: {
      input: logFactsContributionSchema,
      handle: (_state, input, events) => [events.logFactsContributed(input)],
    },
    contributeMetricFacts: {
      input: metricFactsContributionSchema,
      handle: (_state, input, events) => [events.metricFactsContributed(input)],
    },
  })
  .build();

export type CodingAgentSessionAggregate = typeof codingAgentSession;

/**
 * The persisted type strings `event_log` already holds. `defineAggregate`'s
 * `prefix` reproduces them from the event keys below.
 */
export const SPAN_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.span_facts_contributed";
export const LOG_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.log_facts_contributed";
export const METRIC_FACTS_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.coding_agent_session.metric_facts_contributed";

/** camelCase -> snake_case, for the legacy-tail equivalence test above. */
export function toSnakeCase(camelCase: string): string {
  return camelCase.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * The aggregate id: the resolved session id. The computation itself happens
 * once, in `sessionIdentity.ts`'s `resolveCodingAgentSessionId`; every
 * command's `sessionId` already carries its result.
 */
export function codingAgentSessionAggregateId(data: {
  sessionId: string;
}): string {
  return data.sessionId;
}
