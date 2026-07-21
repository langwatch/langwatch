import type { LangyMessageProjection } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type { LangyMessageProjectionRecord } from "@langwatch/langy";
import { PrismaLangyMessageProjectionRepository } from "../langy-message-projection.prisma.repository";

type Row = LangyMessageProjection;
type Client = ConstructorParameters<
  typeof PrismaLangyMessageProjectionRepository
>[0];
type Upsert = Client["langyMessageProjection"]["upsert"];

const record: LangyMessageProjectionRecord = {
  ConversationId: "conversation-1",
  MessageId: "message-1",
  Role: "user",
  Parts: [
    {
      type: "text",
      text: "Show me the slow traces",
      metadata: { thresholds: [100, 500, null] },
    },
  ],
  SourceEventId: "event-1",
  OccurredAt: 100,
  AcceptedAt: 120,
  CreatedAt: 100,
  UpdatedAt: 100,
};

function context(projectId: string): ProjectionStoreContext {
  return {
    aggregateId: record.ConversationId,
    tenantId: createTenantId(projectId),
  };
}

function row(projectId = "project-1"): Row {
  return {
    id: "message-row-1",
    projectId,
    ...record,
  };
}

describe("PrismaLangyMessageProjectionRepository", () => {
  it("uses a tenant-scoped upsert so retrying the same event is idempotent", async () => {
    const upsert = vi.fn<Upsert>(async () => row());
    const client = {
      langyMessageProjection: { upsert },
    } satisfies Client;
    const repository = new PrismaLangyMessageProjectionRepository(client);

    await repository.append(record, context("project-1"));
    await repository.append(record, context("project-1"));

    const expected = {
      where: {
        projectId: "project-1",
        projectId_ConversationId_MessageId: {
          projectId: "project-1",
          ConversationId: "conversation-1",
          MessageId: "message-1",
        },
      },
      create: { projectId: "project-1", ...record },
      update: record,
    };
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, expected);
    expect(upsert).toHaveBeenNthCalledWith(2, expected);
  });

  it("does not share a message key between projects", async () => {
    const upsert = vi.fn<Upsert>(async () => row());
    const client = {
      langyMessageProjection: { upsert },
    } satisfies Client;
    const repository = new PrismaLangyMessageProjectionRepository(client);

    await repository.append(record, context("project-1"));
    await repository.append(record, context("project-2"));

    expect(upsert.mock.calls.map(([args]) => args.where)).toEqual([
      {
        projectId: "project-1",
        projectId_ConversationId_MessageId: {
          projectId: "project-1",
          ConversationId: "conversation-1",
          MessageId: "message-1",
        },
      },
      {
        projectId: "project-2",
        projectId_ConversationId_MessageId: {
          projectId: "project-2",
          ConversationId: "conversation-1",
          MessageId: "message-1",
        },
      },
    ]);
  });
});
