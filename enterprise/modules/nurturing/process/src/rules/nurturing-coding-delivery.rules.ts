// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import { Temporal } from "@langwatch/time";

const CODING_AND_APP_KINDS = [
  "coding_session_stored",
  "coding_active_days",
  "coding_agent_types",
  "coding_agent_first_session",
  "app_opened",
  "sessions_page_viewed",
] as const;

/** The signals of the coding-agent and app-open facts: Customer.io only, never PostHog. */
type CodingOrAppSignal = NurturingSignalOf<(typeof CODING_AND_APP_KINDS)[number]>;

export function isCodingOrAppSignal(signal: NurturingSignal): signal is CodingOrAppSignal {
  return (CODING_AND_APP_KINDS as readonly string[]).includes(signal.kind);
}

function isoOf(epochMilliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds).toString({
    fractionalSecondDigits: 3,
  });
}

/**
 * What Customer.io is told for a coding-agent or app-open signal. The first session is the only
 * one that also tracks an event; a new kind in the list above fails to compile here until handled.
 */
export function fireCodingOrApp(signal: CodingOrAppSignal): CioBatchCall[] {
  const { userId } = signal;
  switch (signal.kind) {
    case "coding_session_stored":
      return [
        { type: "identify", userId, traits: { coding_last_session_at: isoOf(signal.occurredAt) } },
      ];
    case "coding_active_days":
      return [
        { type: "identify", userId, traits: { coding_active_days: signal.codingActiveDays } },
      ];
    case "coding_agent_types":
      return [{ type: "identify", userId, traits: { coding_agent_types: signal.agentTypes } }];
    case "coding_agent_first_session":
      return [
        {
          type: "identify",
          userId,
          traits: {
            coding_first_session_at: isoOf(signal.occurredAt),
            coding_agent_types: signal.agentTypes,
          },
        },
        {
          type: "track",
          userId,
          event: "coding_agent_first_session",
          properties: { agent_type: signal.agentType, project_id: signal.projectId },
        },
      ];
    case "app_opened":
      return [
        { type: "identify", userId, traits: { app_last_opened_at: isoOf(signal.occurredAt) } },
      ];
    case "sessions_page_viewed":
      return [
        { type: "track", userId, event: "sessions_page_viewed", properties: { page: signal.page } },
      ];
    default: {
      signal satisfies never;
      return [];
    }
  }
}

type Debounce = Readonly<{ seconds: number; claimKey: string }>;

/** The tenant's trace, simulation, evaluation or coding update: main's CRM contract, five minutes. */
const TENANT_UPDATE_SECONDS = 5 * 60;
const TENANT_UPDATE_KINDS: ReadonlySet<NurturingSignal["kind"]> = new Set([
  "trace_received",
  "simulation_run_finished",
  "evaluation_completed",
  "coding_session_stored",
]);
/** An app open names the person as its tenant, so the hour is spent per person across pods. */
const PERSON_HOUR_SECONDS = 60 * 60;
const PERSON_HOUR_KINDS: ReadonlySet<NurturingSignal["kind"]> = new Set([
  "app_opened",
  "sessions_page_viewed",
]);

/** The windows a Customer.io update waits out: one, or none for a kind that is never debounced. */
export function customerIoDebouncesOf(signal: NurturingSignal): Debounce[] {
  if (TENANT_UPDATE_KINDS.has(signal.kind)) {
    // Main's key, unchanged for the kinds that existed before.
    return [
      {
        seconds: TENANT_UPDATE_SECONDS,
        claimKey: `nurturing:cio-sync:${signal.kind}:${signal.tenantId}`,
      },
    ];
  }
  if (PERSON_HOUR_KINDS.has(signal.kind)) {
    return [
      {
        seconds: PERSON_HOUR_SECONDS,
        claimKey: `nurturing:debounce:${signal.kind}:${signal.tenantId}`,
      },
    ];
  }
  return [];
}
