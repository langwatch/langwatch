import type { ScenarioCreatedSignal } from "@langwatch/enterprise-billing-contract";
/**
 * A created scenario is recorded on scenario's own pipeline, and the worker's
 * subscriber announces it to billing. @see specs/analytics/posthog-guided-onboarding.feature
 */
import { createTenantId, type EventingCommandSender } from "@langwatch/eventing";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SCENARIO_CREATED_EVENT_VERSION,
  type ScenarioCreatedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createScenarioRestTestApp,
  PROJECT_ID,
} from "../../transport/__tests__/scenario-rest.harness.ts";
import {
  RecordScenarioCreatedCommand,
  type RecordScenarioCreatedCommandData,
} from "../scenario-lifecycle.commands.ts";

const signal = {
  scenarioId: "scenario-1",
  projectId: PROJECT_ID,
  userId: "user-1",
  scenarioCount: 3,
};

function recordingSender(): {
  sender: EventingCommandSender<RecordScenarioCreatedCommandData>;
  sent: RecordScenarioCreatedCommandData[];
} {
  const sent: RecordScenarioCreatedCommandData[] = [];
  return {
    sent,
    sender: {
      send: async (payload) => {
        sent.push(payload);
      },
      sendBatch: async (payloads) => {
        sent.push(...payloads);
      },
      close: async () => {},
      waitUntilReady: async () => {},
    },
  };
}

function createdEvent(): ScenarioCreatedEvent {
  const [event] = new RecordScenarioCreatedCommand().handle({
    tenantId: createTenantId(PROJECT_ID),
    type: "lw.scenario.record_created",
    aggregateId: signal.scenarioId,
    data: { tenantId: PROJECT_ID, occurredAt: 1_700_000_000_000, ...signal },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("the scenario lifecycle pipeline", () => {
  describe("when the record-created command is handled", () => {
    it("appends one scenario_created event keyed by the scenario", () => {
      const event = createdEvent();

      expect(event).toMatchObject({
        type: SCENARIO_CREATED_EVENT_TYPE,
        version: SCENARIO_CREATED_EVENT_VERSION,
        aggregateType: "scenario",
        aggregateId: "scenario-1",
        idempotencyKey: `${PROJECT_ID}:scenario-1:created`,
        data: signal,
      });
    });
  });

  describe("when a scenario is created through the app", () => {
    it("sends the command with how many scenarios the project now holds", async () => {
      const { app } = await createScenarioRestTestApp();
      const { sender, sent } = recordingSender();
      app.connectLifecycleCommands({ recordScenarioCreated: sender });

      const first = await app.create(
        { projectId: PROJECT_ID, name: "Login", situation: "logs in", criteria: [], labels: [] },
        { id: "user-1", label: "user" },
      );
      await app.create(
        { projectId: PROJECT_ID, name: "Logout", situation: "logs out", criteria: [], labels: [] },
        { id: "user-1", label: "user" },
      );

      await vi.waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[0]).toMatchObject({
        tenantId: PROJECT_ID,
        scenarioId: first.id,
        projectId: PROJECT_ID,
        userId: "user-1",
        scenarioCount: 1,
      });
      expect(sent[1]).toMatchObject({ scenarioCount: 2 });
    });
  });

  describe("when the worker's subscriber handles scenario_created", () => {
    it("announces the scenario to billing", async () => {
      const announced: ScenarioCreatedSignal[] = [];
      const { app } = await createScenarioRestTestApp({
        billing: {
          recordScenarioCreated: async (input) => {
            announced.push(input);
          },
        },
      });
      const subscriber = app.lifecyclePipeline().eventSubscribers.get("scenarioCreatedNurturing");
      if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

      await subscriber.handle(createdEvent(), { tenantId: PROJECT_ID, aggregateId: "scenario-1" });

      expect(announced).toEqual([signal]);
    });

    it("lets a billing failure reach the queue, which records it", async () => {
      const { app } = await createScenarioRestTestApp({
        billing: {
          recordScenarioCreated: async () => {
            throw new Error("billing unavailable");
          },
        },
      });
      const subscriber = app.lifecyclePipeline().eventSubscribers.get("scenarioCreatedNurturing");
      if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

      await expect(
        subscriber.handle(createdEvent(), { tenantId: PROJECT_ID, aggregateId: "scenario-1" }),
      ).rejects.toThrow("billing unavailable");
    });
  });
});
