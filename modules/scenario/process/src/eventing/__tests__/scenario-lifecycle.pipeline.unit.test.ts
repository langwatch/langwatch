/**
 * A created scenario is recorded on scenario's own pipeline, and nurturing
 * reacts to its event from its own side.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId, type EventingCommandSender } from "@langwatch/eventing";
import type { OrgAdminResolution } from "@langwatch/project-contract";
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

function orgAdmin(organizationId: string | null): OrgAdminResolution {
  return {
    userId: "admin-1",
    organizationId,
    firstMessage: false,
    onboardingVariant: "guided",
    organizationCreatedAt: null,
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
    it("sends the command with how many scenarios the organization now holds", async () => {
      const { app } = await createScenarioRestTestApp({
        projects: {
          resolveOrgAdmin: async () => orgAdmin("org-1"),
          listIdsByOrganization: async () => [PROJECT_ID],
        },
      });
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
        onboardingVariant: "guided",
      });
      expect(sent[1]).toMatchObject({ scenarioCount: 2 });
    });

    it("records no variant when the organization's cannot be read, and still records the scenario", async () => {
      const { app } = await createScenarioRestTestApp();
      const { sender, sent } = recordingSender();
      app.connectLifecycleCommands({ recordScenarioCreated: sender });

      await app.create(
        { projectId: PROJECT_ID, name: "Login", situation: "logs in", criteria: [], labels: [] },
        { id: "user-1", label: "user" },
      );

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({ scenarioCount: 1, onboardingVariant: null });
    });

    /** @scenario A created scenario records the organization's scenario count across its projects */
    it("counts the scenarios of every project of the organization", async () => {
      const otherProject = `${PROJECT_ID}_b`;
      const { app } = await createScenarioRestTestApp({
        projects: {
          resolveOrgAdmin: async () => orgAdmin("org-1"),
          listIdsByOrganization: async () => [PROJECT_ID, otherProject],
        },
      });
      const { sender, sent } = recordingSender();
      app.connectLifecycleCommands({ recordScenarioCreated: sender });
      const by = { id: "user-1", label: "user" } as const;
      const scenario = (projectId: string, name: string) => ({
        projectId,
        name,
        situation: name,
        criteria: [],
        labels: [],
      });

      await app.create(scenario(PROJECT_ID, "A1"), by);
      await app.create(scenario(PROJECT_ID, "A2"), by);
      await app.create(scenario(otherProject, "B1"), by);
      const fourth = await app.create(scenario(otherProject, "B2"), by);

      await vi.waitFor(() => expect(sent).toHaveLength(4));
      expect(sent.find(({ scenarioId }) => scenarioId === fourth.id)).toMatchObject({
        projectId: otherProject,
        scenarioCount: 4,
      });
    });

    /** @scenario A created scenario whose organization cannot be resolved records the project's count */
    it("falls back to the project's count when the project names no organization", async () => {
      const { app } = await createScenarioRestTestApp({
        projects: { resolveOrgAdmin: async () => orgAdmin(null) },
      });
      const { sender, sent } = recordingSender();
      app.connectLifecycleCommands({ recordScenarioCreated: sender });

      await app.create(
        { projectId: PROJECT_ID, name: "Login", situation: "logs in", criteria: [], labels: [] },
        { id: "user-1", label: "user" },
      );

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({ scenarioCount: 1, onboardingVariant: "guided" });
    });
  });
});
