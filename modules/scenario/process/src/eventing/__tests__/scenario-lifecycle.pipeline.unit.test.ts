/**
 * A created scenario is recorded on scenario's own pipeline, and nurturing
 * reacts to its event from its own side.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId, type EventingCommandSender } from "@langwatch/eventing";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SCENARIO_CREATED_EVENT_VERSION,
  type ScenarioCreatedEvent,
  SIMULATION_SET_CREATED_EVENT_TYPE,
  SIMULATION_SET_CREATED_EVENT_VERSION,
} from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createScenarioRestTestApp,
  PROJECT_ID,
} from "../../transport/__tests__/scenario-rest.harness.ts";
import {
  RecordScenarioCreatedCommand,
  type RecordScenarioCreatedCommandData,
  RecordSimulationSetCreatedCommand,
  type RecordSimulationSetCreatedCommandData,
} from "../scenario-lifecycle.commands.ts";

const signal = {
  scenarioId: "scenario-1",
  projectId: PROJECT_ID,
  userId: "user-1",
  scenarioCount: 3,
};

function recordingSender<Data>(): {
  sender: EventingCommandSender<Data>;
  sent: Data[];
} {
  const sent: Data[] = [];
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

  describe("when the record-simulation-set-created command is handled", () => {
    /** @scenario "A project's first run of a simulation set records the set once" */
    it("appends one simulation_set_created event keyed by the project and the set", () => {
      const data = { scenarioSetId: "checkout-suite", projectId: PROJECT_ID };

      const events = new RecordSimulationSetCreatedCommand().handle({
        tenantId: createTenantId(PROJECT_ID),
        type: "lw.simulation_set.record_created",
        aggregateId: "simulation_set:checkout-suite",
        data: { tenantId: PROJECT_ID, occurredAt: 1_700_000_000_000, ...data },
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: SIMULATION_SET_CREATED_EVENT_TYPE,
        version: SIMULATION_SET_CREATED_EVENT_VERSION,
        aggregateType: "scenario",
        aggregateId: "simulation_set:checkout-suite",
        occurredAt: 1_700_000_000_000,
        idempotencyKey: `${PROJECT_ID}:checkout-suite:simulation_set_created`,
        data: { ...data, occurredAt: 1_700_000_000_000 },
      });
    });
  });

  describe("when a scenario is created through the app", () => {
    it("sends the command with how many scenarios the project now holds", async () => {
      const { app } = await createScenarioRestTestApp({
        projects: {
          resolveOrgAdmin: async () => ({
            userId: "admin-1",
            organizationId: "org-1",
            firstMessage: false,
            onboardingVariant: "guided",
            organizationCreatedAt: null,
          }),
        },
      });
      const { sender, sent } = recordingSender<RecordScenarioCreatedCommandData>();
      app.connectLifecycleCommands({
        recordScenarioCreated: sender,
        recordSimulationSetCreated: recordingSender<RecordSimulationSetCreatedCommandData>().sender,
      });

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
        onboardingVariant: "guided",
      });
      expect(sent[1]).toMatchObject({ scenarioCount: 2 });
    });

    it("records no variant when the organization's cannot be read, and still records the scenario", async () => {
      const { app } = await createScenarioRestTestApp();
      const { sender, sent } = recordingSender<RecordScenarioCreatedCommandData>();
      app.connectLifecycleCommands({
        recordScenarioCreated: sender,
        recordSimulationSetCreated: recordingSender<RecordSimulationSetCreatedCommandData>().sender,
      });

      await app.create(
        { projectId: PROJECT_ID, name: "Login", situation: "logs in", criteria: [], labels: [] },
        { id: "user-1", label: "user" },
      );

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({ scenarioCount: 1, onboardingVariant: null });
    });
  });
});
