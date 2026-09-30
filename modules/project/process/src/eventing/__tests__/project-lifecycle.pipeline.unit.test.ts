/**
 * @vitest-environment node
 *
 * project_lifecycle records a created project; peers react from their own side (§9).
 * @see specs/lwql/project-key-map.feature
 */
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  personalWorkspaceProvisionedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  type ProjectCreatedEventData,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ProjectCreatedNoticeService } from "../../services/project-created-notice.service.ts";
import { RecordProjectCreatedCommand } from "../project-lifecycle.commands.ts";
import type { RecordProjectCreatedCommandData } from "../project-lifecycle.events.ts";
import { buildProjectLifecyclePipeline } from "../project-lifecycle.pipeline.ts";

const CREATED: RecordProjectCreatedCommandData = {
  tenantId: "project_1",
  projectId: "project_1",
  organizationId: "org_acme",
  occurredAt: Date.UTC(2026, 8, 30, 12),
};

describe("project's lifecycle pipeline", () => {
  it("records one created event on the project, keyed so a redelivery collapses", async () => {
    const [event] = await new RecordProjectCreatedCommand().handle({
      tenantId: createTenantId("project_1"),
      aggregateId: "project_1",
      type: RecordProjectCreatedCommand.schema.type,
      data: CREATED,
    });

    expect(event?.type).toBe(PROJECT_CREATED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("project_1");
    expect(event?.data).toEqual(CREATED);
    expect(event?.idempotencyKey).toBe("project_1:created");
  });

  it("hosts no reaction on its own events", () => {
    const definition = buildProjectLifecyclePipeline({ recordProjectCreated: async () => void 0 });

    expect(definition.eventSubscribers.size).toBe(0);
  });
});

/** Organization's pipeline as its contract names the event; project reads only type and data. */
function organizationStandIn() {
  return definePipeline({
    name: "organization_lifecycle",
    aggregate: defineAggregate({ type: "organization" }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE),
        data: personalWorkspaceProvisionedEventDataSchema,
      }),
    ])
    .build();
}

/** A peer of project's, as analytics is: it hears project's created event from its own side. */
function createdListener(heard: (data: ProjectCreatedEventData) => Promise<void>) {
  return definePipeline({
    name: "created_listener",
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("heard", {
      eventType: PROJECT_CREATED_EVENT_TYPE,
      data: projectCreatedEventDataSchema,
      handle: heard,
    })
    .build();
}

describe("given organization records a newly created personal workspace", () => {
  /** @scenario "A personal workspace project is recorded as created" */
  it("records the personal project as created on project's own pipeline", async () => {
    const heard = vi.fn(async (_data: ProjectCreatedEventData) => void 0);
    const notice = ProjectCreatedNoticeService.create({ logger: { error: () => void 0 } });
    const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
    const organization = eventing.register(organizationStandIn());
    const lifecycle = eventing.register(
      buildProjectLifecyclePipeline({ recordProjectCreated: (input) => notice.record(input) }),
    );
    notice.connect({ recordProjectCreated: lifecycle.commands.recordProjectCreated });
    eventing.register(createdListener(heard));

    await organization.service.storeEvents(
      [
        {
          id: "event-provisioned",
          aggregateId: "org_acme",
          aggregateType: "organization",
          tenantId: createTenantId("org_acme"),
          type: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
          version: "2026-09-30",
          createdAt: 1,
          occurredAt: 1,
          data: {
            tenantId: "org_acme",
            organizationId: "org_acme",
            userId: "user_1",
            projectId: "project_personal",
            occurredAt: 1,
          },
        },
      ],
      { tenantId: createTenantId("org_acme") },
    );

    await vi.waitFor(() =>
      expect(heard).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project_personal",
          projectId: "project_personal",
          organizationId: "org_acme",
        }),
      ),
    );
    await eventing.close();
  });
});
