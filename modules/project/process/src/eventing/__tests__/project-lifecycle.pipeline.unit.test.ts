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
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  personalTeamCreatedEventDataSchema,
  personalWorkspaceProvisionedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_TYPE,
  PROJECT_ARCHIVED_EVENT_TYPE,
  type ProjectCreatedEventData,
  projectCreatedEventDataSchema,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { PersonalProjectService } from "../../services/personal-project.service.ts";
import { ProjectCreatedNoticeService } from "../../services/project-created-notice.service.ts";
import { ProjectCredentialsService } from "../../services/project-credentials.service.ts";
import {
  RecordProjectCreatedCommand,
  RecordProjectLegacyKeyRevokedCommand,
  RecordProjectPresenceSettingChangedCommand,
  RecordProjectMovedCommand,
  RecordProjectArchivedCommand,
} from "../project-lifecycle.commands.ts";
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

  it("records a revoked legacy key as a fact carrying ids and no key", async () => {
    const data = { ...CREATED, revokedByUserId: "user_1" };
    const [event] = await new RecordProjectLegacyKeyRevokedCommand().handle({
      tenantId: createTenantId("project_1"),
      aggregateId: "project_1",
      type: RecordProjectLegacyKeyRevokedCommand.schema.type,
      data,
    });

    expect(event?.type).toBe(PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("project_1");
    expect(event?.data).toEqual(data);
  });

  /** @scenario "A project moved to another team is recorded as project's fact" */
  it("records a move with both teams, keyed on its moment", async () => {
    const data = { ...CREATED, fromTeamId: "team_alpha", toTeamId: "team_beta" };
    const [event] = await new RecordProjectMovedCommand().handle({
      tenantId: createTenantId("project_1"),
      aggregateId: "project_1",
      type: RecordProjectMovedCommand.schema.type,
      data,
    });

    expect(event?.type).toBe(PROJECT_MOVED_EVENT_TYPE);
    expect(event?.aggregateId).toBe("project_1");
    expect(event?.data).toEqual(data);
    expect(event?.idempotencyKey).toBe(`project_1:moved:${CREATED.occurredAt}`);
  });

  /** @scenario "An archived project is recorded as project's fact" */
  it("records an archive with the project's organization, keyed on its moment", async () => {
    const [event] = await new RecordProjectArchivedCommand().handle({
      tenantId: createTenantId("project_1"),
      aggregateId: "project_1",
      type: RecordProjectArchivedCommand.schema.type,
      data: CREATED,
    });

    expect(event?.type).toBe(PROJECT_ARCHIVED_EVENT_TYPE);
    expect(event?.data).toEqual(CREATED);
    expect(event?.idempotencyKey).toBe(`project_1:archived:${CREATED.occurredAt}`);
  });

  describe("when a project's presence setting is recorded", () => {
    const presence = (data: { occurredAt: number; backfilled?: boolean }) =>
      new RecordProjectPresenceSettingChangedCommand().handle({
        tenantId: createTenantId("project_1"),
        aggregateId: "project_1",
        type: RecordProjectPresenceSettingChangedCommand.schema.type,
        data: {
          tenantId: "project_1",
          projectId: "project_1",
          organizationId: "org_acme",
          presenceEnabled: false,
          ...(data.backfilled ? { backfilled: true } : { changedByUserId: "user_1" }),
          occurredAt: data.occurredAt,
        },
      });

    /** @scenario "A changed project presence setting is recorded as project's fact" */
    it("records a change on the project, carrying who changed it, keyed on its moment", async () => {
      const [first] = await presence({ occurredAt: 1 });
      const [second] = await presence({ occurredAt: 2 });

      expect(first?.type).toBe(PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE);
      expect(first?.aggregateId).toBe("project_1");
      expect(first?.data).toMatchObject({ presenceEnabled: false, changedByUserId: "user_1" });
      expect(first?.data.backfilled).toBeUndefined();
      expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
    });

    /** @scenario "Existing projects' presence settings are recorded by the backfill, idempotently" */
    it("keys a backfilled setting once per project, so a re-run collapses", async () => {
      const [first] = await presence({ occurredAt: 1, backfilled: true });
      const [rerun] = await presence({ occurredAt: 2, backfilled: true });

      expect(first?.idempotencyKey).toBe("project_1:presence-setting:backfilled");
      expect(rerun?.idempotencyKey).toBe(first?.idempotencyKey);
    });
  });

  it("hosts no reaction on its own events", () => {
    const definition = buildProjectLifecyclePipeline({
      recordProjectCreated: async () => void 0,
      personalProjects: {
        create: async () => "project_personal",
        archive: async () => {},
        revive: async () => {},
        setFeatures: async () => {},
      },
    });

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
      z.object({
        ...EventSchema.shape,
        type: z.literal(PERSONAL_TEAM_CREATED_EVENT_TYPE),
        data: personalTeamCreatedEventDataSchema,
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
      handle: (data) => heard(data),
    })
    .build();
}

describe("given organization records a newly created personal workspace", () => {
  /** @scenario "A personal workspace project is recorded as created" */
  it("records the personal project as created on project's own pipeline", async () => {
    const heard = vi.fn(async (_data: ProjectCreatedEventData) => void 0);
    const notice = ProjectCreatedNoticeService.create({
      logger: { error: () => void 0 },
      projects: {
        findWithOrgAdmin: async () => null,
        findIdsByOrganization: async () => [],
        findWithTeam: async () => null,
      },
    });
    const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
    const organization = eventing.register(organizationStandIn());
    const lifecycle = eventing.register(
      buildProjectLifecyclePipeline({
        recordProjectCreated: (input) => notice.record(input),
        personalProjects: {
          create: async () => "project_personal",
          archive: async () => {},
          revive: async () => {},
          setFeatures: async () => {},
        },
      }),
    );
    notice.connect({
      recordProjectCreated: lifecycle.commands.recordProjectCreated,
      recordProjectLegacyKeyRevoked: lifecycle.commands.recordProjectLegacyKeyRevoked,
      recordPresenceSettingChanged: lifecycle.commands.recordPresenceSettingChanged,
      recordProjectMoved: lifecycle.commands.recordProjectMoved,
      recordProjectArchived: lifecycle.commands.recordProjectArchived,
      recordProjectDepartmentAssigned: lifecycle.commands.recordProjectDepartmentAssigned,
      recordProjectTraceSharingDisabled: lifecycle.commands.recordProjectTraceSharingDisabled,
      recordProjectAggregateRuleChanged: lifecycle.commands.recordProjectAggregateRuleChanged,
      recordProjectRevived: lifecycle.commands.recordProjectRevived,
    });
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

describe("given organization records a personal team's creation twice under two project ids", () => {
  /** @scenario "A second personal-team fact for a team records only the team's existing project as created" */
  it("creates one project and records only that real row as created", async () => {
    const memory = MemoryProjectDatabase.create();
    const recorded = vi.fn(async (_input: { projectId: string; organizationId: string }) => void 0);
    const personalProjects = PersonalProjectService.create({
      projects: MemoryProjectRepository.create({ memory }),
      credentials: ProjectCredentialsService.create(),
      lifecycle: { revived: async () => undefined },
    });
    const eventing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
    const organization = eventing.register(organizationStandIn());
    eventing.register(
      buildProjectLifecyclePipeline({ recordProjectCreated: recorded, personalProjects }),
    );
    const fact = (id: string, projectId: string, at: number) => ({
      id,
      aggregateId: "org_acme",
      aggregateType: "organization" as const,
      tenantId: createTenantId("org_acme"),
      type: PERSONAL_TEAM_CREATED_EVENT_TYPE,
      version: "2026-10-08",
      createdAt: at,
      occurredAt: at,
      data: {
        tenantId: "org_acme",
        organizationId: "org_acme",
        userId: "user_1",
        teamId: "team_personal",
        projectId,
        projectSlug: `personal-${projectId}`,
        occurredAt: at,
      },
    });

    await organization.service.storeEvents([fact("event-first", "project_real", 1)], {
      tenantId: createTenantId("org_acme"),
    });
    await vi.waitFor(() => expect(recorded).toHaveBeenCalledTimes(1));
    await organization.service.storeEvents([fact("event-second", "project_phantom", 2)], {
      tenantId: createTenantId("org_acme"),
    });
    await vi.waitFor(() => expect(recorded).toHaveBeenCalledTimes(2));
    await eventing.close();

    expect(memory.findProject("project_phantom")).toBeUndefined();
    expect(new Set(recorded.mock.calls.map(([input]) => input.projectId))).toEqual(
      new Set(["project_real"]),
    );
  });
});
