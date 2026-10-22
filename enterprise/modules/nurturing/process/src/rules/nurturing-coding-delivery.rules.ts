// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  CioBatchCall,
  NurturingSignal,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";

import { isoOf } from "./nurturing-time.rules.ts";

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

/**
 * What Customer.io is told for a coding-agent or app-open signal. The first session is the only
 * one that also tracks an event; a new kind in the list above fails to compile here until handled.
 */
/**
 * A member of an organization that sends coding-agent sessions. A trait of its own, so the
 * integration_method a member chose in onboarding is never overwritten.
 */
export function fireUsesCodingAgent({ userId }: { userId: string }): CioBatchCall[] {
  return [{ type: "identify", userId, traits: { uses_coding_agent: true } }];
}

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
