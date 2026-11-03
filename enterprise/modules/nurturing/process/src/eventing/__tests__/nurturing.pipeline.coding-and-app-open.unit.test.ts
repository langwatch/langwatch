// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import { APP_PAGE_OPENED_EVENT_TYPE } from "@langwatch/auth-contract";
import {
  CODING_AGENT_SESSION_STORED_EVENT_TYPE,
  type CodingAgentSessionStoredEventData,
} from "@langwatch/coding-agent-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

const AT = Date.UTC(2026, 9, 20, 12);

function nurturing() {
  const delivered: NurturingSignal[] = [];
  const codingBatches: CodingAgentSessionStoredEventData[][] = [];
  const pipeline = buildNurturingPipeline({
    deliver: async ({ signal }) => void delivered.push(signal),
    projectCreated: async () => undefined,
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async () => undefined,
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async ({ sessions }) => void codingBatches.push([...sessions]),
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const lanesOf = (type: string) =>
    subscribers.filter(({ eventTypes }) => eventTypes.includes(type));
  return { delivered, codingBatches, lanesOf };
}

const appOpenedFact = (): Event =>
  ({
    id: "evt-app-opened",
    aggregateId: "user-1",
    aggregateType: "user",
    tenantId: createTenantId("user-1"),
    createdAt: AT,
    occurredAt: AT,
    type: APP_PAGE_OPENED_EVENT_TYPE,
    version: "2026-10-21",
    data: { tenantId: "user-1", userId: "user-1", page: "me_sessions", occurredAt: AT },
    idempotencyKey: `user-1:app_page_opened:me_sessions:${AT}`,
  }) as Event;

const sessionStoredFact = (): Event =>
  ({
    id: "evt-session-stored",
    aggregateId: `project-1:${AT}`,
    aggregateType: "coding_agent_project_milestone",
    tenantId: createTenantId("project-1"),
    createdAt: AT,
    occurredAt: AT,
    type: CODING_AGENT_SESSION_STORED_EVENT_TYPE,
    version: "2026-10-21",
    data: {
      tenantId: "project-1",
      projectId: "project-1",
      sessionId: "session-1",
      agentType: "claude_code",
      firstForProject: true,
      occurredAt: AT,
    },
    idempotencyKey: `project-1:coding_agent_session_stored:session-1:${AT}`,
  }) as Event;

describe("nurturing's appPageOpened peer subscriber", () => {
  describe("when auth records an app open", () => {
    /** @scenario "An app open identifies app_last_opened_at and tracks sessions_page_viewed on the opening user" */
    it("delivers an app_opened and a sessions_page_viewed signal for the opening user", async () => {
      const { delivered, lanesOf } = nurturing();

      for (const lane of lanesOf(APP_PAGE_OPENED_EVENT_TYPE)) {
        await lane.handle?.(appOpenedFact(), {
          tenantId: createTenantId("user-1"),
          aggregateId: "user-1",
        });
      }

      expect(
        delivered.map((signal) => [signal.kind, "userId" in signal ? signal.userId : null]),
      ).toEqual([
        ["app_opened", "user-1"],
        ["sessions_page_viewed", "user-1"],
      ]);
    });
  });
});

describe("nurturing's codingAgentSessionStored peer subscriber", () => {
  describe("when coding-agent records a session-stored fact", () => {
    /** @scenario "The first coding-agent session raises one first-session signal" */
    it("hands the fact's data to the coding milestones step", async () => {
      const { codingBatches, lanesOf } = nurturing();
      const event = sessionStoredFact();

      for (const lane of lanesOf(CODING_AGENT_SESSION_STORED_EVENT_TYPE)) {
        await lane.handleBatch?.(
          [event],
          [{ tenantId: event.tenantId, aggregateId: event.aggregateId }],
        );
      }

      expect(codingBatches).toEqual([[event.data]]);
    });
  });
});
