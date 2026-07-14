import {
  type LangyConversationProjection,
  LangyProjectionTitleSource,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { Event } from "~/server/event-sourcing/domain/types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type { StateProjectionDefinition } from "~/server/event-sourcing/projections/stateProjection.types";
import { StateProjectionExecutor } from "~/server/event-sourcing/projections/stateProjectionExecutor";
import type { LangyConversationStateData } from "~/server/event-sourcing/pipelines/langy-conversation-processing/projections/langyConversationState.foldProjection";
import { PrismaLangyConversationProjectionRepository } from "../langy-conversation-projection.prisma.repository";

type Row = LangyConversationProjection;
type Client = ConstructorParameters<
  typeof PrismaLangyConversationProjectionRepository
>[0];
type FindUnique = Client["langyConversationProjection"]["findUnique"];
type Upsert = Client["langyConversationProjection"]["upsert"];

const conversationId = "conversation-1";

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    projectId: "project-1",
    ConversationId: conversationId,
    UserId: "user-1",
    Title: "A conversation",
    TitleSource: LangyProjectionTitleSource.derived,
    Status: "active",
    IsShared: false,
    SharedAt: null,
    SharedById: null,
    MessageCount: 1,
    LastActivityAt: 150,
    CurrentTurnId: null,
    LastError: null,
    PendingHandoffToken: null,
    PendingHandoffTurnId: null,
    RunToken: "run-token",
    ArchivedAt: null,
    CreatedAt: 100,
    UpdatedAt: 150,
    OccurredAt: 150,
    AcceptedAt: 200,
    LastEventId: "event-b",
    ProjectionVersion: "v1",
    ...overrides,
  };
}

function setup(find: FindUnique = vi.fn<FindUnique>()) {
  const findUnique = vi.fn<FindUnique>(find);
  const upsert = vi.fn<Upsert>(async () => row());
  const client = {
    langyConversationProjection: { findUnique, upsert },
  } satisfies Client;
  return {
    findUnique,
    repository: new PrismaLangyConversationProjectionRepository(client),
    upsert,
  };
}

function context(projectId: string): ProjectionStoreContext {
  return {
    aggregateId: conversationId,
    tenantId: createTenantId(projectId),
  };
}

describe("PrismaLangyConversationProjectionRepository", () => {
  it("loads solely through the project-scoped conversation key", async () => {
    const { findUnique, repository } = setup(async (args) => {
      const key = args.where.projectId_ConversationId;
      return row({
        projectId: key?.projectId,
        UserId: `owner-of-${key?.projectId}`,
      });
    });

    const projectOne = await repository.load(
      conversationId,
      context("project-1"),
    );
    const projectTwo = await repository.load(
      conversationId,
      context("project-2"),
    );

    expect(projectOne?.state.UserId).toBe("owner-of-project-1");
    expect(projectTwo?.state.UserId).toBe("owner-of-project-2");
    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: {
        projectId: "project-1",
        projectId_ConversationId: {
          projectId: "project-1",
          ConversationId: conversationId,
        },
      },
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        projectId: "project-2",
        projectId_ConversationId: {
          projectId: "project-2",
          ConversationId: conversationId,
        },
      },
    });
  });

  it("round-trips entity timestamps and the acceptedAt/eventId cursor", async () => {
    const storedRow = row();
    const { repository, upsert } = setup(async () => storedRow);
    const projection = await repository.load(
      conversationId,
      context("project-1"),
    );

    expect(projection).toEqual({
      state: expect.objectContaining({
        ConversationId: conversationId,
        LastEventOccurredAt: 150,
      }),
      cursor: { acceptedAt: 200, eventId: "event-b" },
      occurredAt: 150,
      createdAt: 100,
      updatedAt: 150,
      version: "v1",
    });

    await repository.store(projection!, context("project-1"));

    expect(upsert).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        projectId_ConversationId: {
          projectId: "project-1",
          ConversationId: conversationId,
        },
      },
      create: expect.objectContaining({
        projectId: "project-1",
        ConversationId: conversationId,
        AcceptedAt: 200,
        LastEventId: "event-b",
        OccurredAt: 150,
        CreatedAt: 100,
        UpdatedAt: 150,
      }),
      update: expect.objectContaining({
        ConversationId: conversationId,
        AcceptedAt: 200,
        LastEventId: "event-b",
      }),
    });
  });

  it("leaves duplicate and stale-event rejection to the executor and performs no write", async () => {
    const { repository, upsert } = setup(async () => row());
    const apply = vi.fn((state: LangyConversationStateData) => state);
    const projection: StateProjectionDefinition<LangyConversationStateData> = {
      name: "langyConversationState",
      version: "v1",
      eventTypes: ["test.integration.event"],
      init: () => rowToState(row()),
      apply,
      store: repository,
    };
    const event = (
      id: string,
      acceptedAt: number,
    ): Event<Record<string, never>> => ({
      id,
      aggregateId: conversationId,
      aggregateType: "langy_conversation",
      tenantId: createTenantId("project-1"),
      createdAt: acceptedAt,
      occurredAt: 140,
      type: "test.integration.event",
      version: "v1",
      data: {},
    });

    await new StateProjectionExecutor().execute({
      projection,
      events: [event("event-b", 200), event("event-z", 199)],
      context: context("project-1"),
    });

    expect(apply).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});

function rowToState(source: Row): LangyConversationStateData {
  const {
    id: _id,
    projectId: _projectId,
    OccurredAt,
    AcceptedAt: _acceptedAt,
    LastEventId: _lastEventId,
    ProjectionVersion: _projectionVersion,
    ...state
  } = source;
  return { ...state, LastEventOccurredAt: OccurredAt };
}
