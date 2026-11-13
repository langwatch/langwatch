// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The registry's pipeline on the in-memory runtime: the agent module's facts reach governance's
 * peer subscribers, which reconcile the project's organisation; both lanes settle per project.
 * Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
import {
  AGENT_ARCHIVED_EVENT_TYPE,
  AGENT_CHANGED_EVENT_TYPE,
  agentArchivedEventDataSchema,
  agentChangedEventDataSchema,
} from "@langwatch/agent-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  type Event,
  EventSchema,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory, InMemoryProcessStore } from "@langwatch/eventing/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { buildAgentRegistryPipeline } from "../../features/registry/eventing/agent-registry.pipeline.ts";

const PROJECT = "project_checkout";

/** The agent module's pipeline as its contract names the two facts. */
function agentStandIn() {
  return definePipeline({ name: "agent_lifecycle", aggregate: defineAggregate({ type: "agent" }) })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(AGENT_CHANGED_EVENT_TYPE),
        data: agentChangedEventDataSchema,
      }),
      z.object({
        ...EventSchema.shape,
        type: z.literal(AGENT_ARCHIVED_EVENT_TYPE),
        data: agentArchivedEventDataSchema,
      }),
    ])
    .build();
}

function fact({
  id,
  type,
  agentId,
  at,
}: {
  id: string;
  type: typeof AGENT_CHANGED_EVENT_TYPE | typeof AGENT_ARCHIVED_EVENT_TYPE;
  agentId: string;
  at: number;
}): Event {
  return {
    id,
    aggregateId: agentId,
    aggregateType: "agent",
    tenantId: createTenantId(PROJECT),
    type,
    version: "2026-11-13",
    createdAt: at,
    occurredAt: at,
    data:
      type === AGENT_CHANGED_EVENT_TYPE
        ? { agentId, projectId: PROJECT, changeId: id, occurredAt: at }
        : { agentId, projectId: PROJECT, cascadedWorkflowId: null, occurredAt: at },
  } as Event;
}

let eventing: EventSourcing | undefined;

afterEach(async () => {
  await eventing?.close();
  eventing = undefined;
});

type PipelineSetup = Parameters<typeof buildAgentRegistryPipeline>[0];

function setup({ reconciled }: { reconciled: string[] }): PipelineSetup {
  return {
    participation: "consume",
    repositories: undefined,
    processStore: InMemoryProcessStore.createForTesting(),
    app: createApiFixture<PipelineSetup["app"]>({
      connectAgentRegistryOutbox: () => undefined,
      reconcileAgentRegistryForProject: async ({ projectId }) => {
        reconciled.push(projectId);
      },
    }),
  };
}

function world() {
  const reconciled: string[] = [];
  const pipelineSetup = setup({ reconciled });
  eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: pipelineSetup.processStore,
  });
  const agents = eventing.register(agentStandIn());
  eventing.register(buildAgentRegistryPipeline(pipelineSetup));
  const record = (events: Event[]) =>
    agents.service.storeEvents(events as Parameters<typeof agents.service.storeEvents>[0], {
      tenantId: createTenantId(PROJECT),
    });
  return { reconciled, record };
}

describe("the agent registry pipeline", () => {
  describe("when the agent module records an agent change", () => {
    /** @scenario A recorded agent change reconciles the agent's organisation */
    it("reconciles the agent's project", async () => {
      const { reconciled, record } = world();

      await record([
        fact({ id: "evt_1", type: AGENT_CHANGED_EVENT_TYPE, agentId: "agent_1", at: 1 }),
      ]);

      await vi.waitFor(() => expect(reconciled).toEqual([PROJECT]), { timeout: 15_000 });
    }, 20_000);
  });

  describe("when the agent module records an agent archive", () => {
    /** @scenario A recorded agent archive reconciles the agent's organisation */
    it("reconciles the agent's project", async () => {
      const { reconciled, record } = world();

      await record([
        fact({ id: "evt_1", type: AGENT_ARCHIVED_EVENT_TYPE, agentId: "agent_1", at: 1 }),
      ]);

      await vi.waitFor(() => expect(reconciled).toEqual([PROJECT]), { timeout: 15_000 });
    }, 20_000);
  });

  describe("when changes to one project's agents arrive in a burst", () => {
    /** @scenario A burst of changes to one project's agents settles into one reconcile */
    it("reconciles the project once", async () => {
      const { reconciled, record } = world();

      await Promise.all(
        ["agent_1", "agent_2", "agent_3"].map((agentId, index) =>
          record([
            fact({ id: `evt_${index}`, type: AGENT_CHANGED_EVENT_TYPE, agentId, at: index + 1 }),
          ]),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000));

      expect(reconciled).toEqual([PROJECT]);
    }, 25_000);
  });
});
