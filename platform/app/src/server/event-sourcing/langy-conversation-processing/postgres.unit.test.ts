import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  LANGY_CONVERSATION_SPINE_VERSION,
  LANGY_CONVERSATION_TURN_VERSION,
} from "./folds";
import {
  createLangyConversationStateStore,
  createLangyConversationTurnStore,
  createLangyMessageStore,
} from "./postgres";

const context = { tenantId: "project-1" };

type ConversationRow = Prisma.LangyConversationProjectionGetPayload<object>;
type TurnRow = Prisma.LangyConversationTurnProjectionGetPayload<object>;
type MessageRow = Prisma.LangyMessageProjectionGetPayload<object>;

function conversationRow(
  overrides: Partial<ConversationRow> = {},
): ConversationRow {
  return {
    id: "row-1",
    projectId: "project-1",
    ConversationId: "conv-1",
    UserId: "user-1",
    Title: "a title",
    TitleSource: "user",
    Status: "idle",
    IsShared: true,
    SharedAt: 900,
    SharedById: "user-1",
    MessageCount: 3,
    LastActivityAt: 1_500,
    CurrentTurnId: "turn-1",
    LastError: null,
    PendingHandoffToken: "handoff",
    PendingHandoffTurnId: "turn-0",
    RunToken: "run-token",
    ArchivedAt: null,
    CreatedAt: 100,
    UpdatedAt: 2_000,
    OccurredAt: 1_500,
    AcceptedAt: 1_600,
    LastEventId: "event-9",
    ProjectionVersion: LANGY_CONVERSATION_SPINE_VERSION,
    ...overrides,
  };
}

function conversationPrisma(row: ConversationRow | null) {
  return {
    langyConversationProjection: {
      findUnique: vi.fn(
        async (_args: Prisma.LangyConversationProjectionFindUniqueArgs) => row,
      ),
      upsert: vi.fn(
        async (_args: Prisma.LangyConversationProjectionUpsertArgs) =>
          row ?? conversationRow(),
      ),
    },
  };
}

function turnPrisma() {
  return {
    langyConversationTurnProjection: {
      findUnique: vi.fn(
        async (_args: Prisma.LangyConversationTurnProjectionFindUniqueArgs) =>
          turnRow(),
      ),
      upsert: vi.fn(
        async (_args: Prisma.LangyConversationTurnProjectionUpsertArgs) =>
          turnRow(),
      ),
    },
  };
}

describe("the conversation spine store", () => {
  describe("when the row was written under this projection version", () => {
    it("decodes every column into the field of the same name", async () => {
      const prisma = conversationPrisma(conversationRow());
      const read = await createLangyConversationStateStore({ prisma }).read(
        "conv-1",
        context,
      );

      expect(read).toEqual({
        kind: "found",
        stored: {
          version: LANGY_CONVERSATION_SPINE_VERSION,
          state: {
            ConversationId: "conv-1",
            UserId: "user-1",
            Title: "a title",
            TitleSource: "user",
            Status: "idle",
            IsShared: true,
            SharedAt: 900,
            SharedById: "user-1",
            MessageCount: 3,
            LastActivityAt: 1_500,
            CurrentTurnId: "turn-1",
            LastError: null,
            PendingHandoffToken: "handoff",
            PendingHandoffTurnId: "turn-0",
            RunToken: "run-token",
            ArchivedAt: null,
          },
        },
      });
    });

    it("looks the row up by the compound unique, tenant predicate included", async () => {
      const prisma = conversationPrisma(conversationRow());
      await createLangyConversationStateStore({ prisma }).read(
        "conv-1",
        context,
      );

      expect(
        prisma.langyConversationProjection.findUnique,
      ).toHaveBeenCalledWith({
        where: {
          projectId: "project-1",
          projectId_ConversationId: {
            projectId: "project-1",
            ConversationId: "conv-1",
          },
        },
      });
    });
  });

  describe("when the row was written under another projection version", () => {
    it("refuses it rather than decoding it, and never reports absent", async () => {
      const prisma = conversationPrisma(
        conversationRow({
          ProjectionVersion: "1999-01-01",
          Status: "nonsense",
        }),
      );
      const read = await createLangyConversationStateStore({ prisma }).read(
        "conv-1",
        context,
      );

      expect(read).toEqual({
        kind: "undecodable",
        storedVersion: "1999-01-01",
        cause: undefined,
      });
    });
  });

  describe("when the row carries a status this build cannot interpret", () => {
    it("refuses it rather than storing an unknown value in state", async () => {
      const prisma = conversationPrisma(
        conversationRow({ Status: "nonsense" }),
      );
      const read = await createLangyConversationStateStore({ prisma }).read(
        "conv-1",
        context,
      );

      expect(read.kind).toBe("undecodable");
    });
  });

  describe("when no row exists", () => {
    it("reports absent", async () => {
      const prisma = conversationPrisma(null);
      const read = await createLangyConversationStateStore({ prisma }).read(
        "conv-1",
        context,
      );

      expect(read).toEqual({ kind: "absent" });
    });
  });

  it("stamps CreatedAt only on the create branch, and OccurredAt from LastActivityAt", async () => {
    const prisma = conversationPrisma(conversationRow());
    const { ConversationId, UserId, Title, IsShared, SharedAt, SharedById, MessageCount, LastActivityAt, CurrentTurnId, LastError, PendingHandoffToken, PendingHandoffTurnId, RunToken, ArchivedAt } =
      conversationRow();
    await createLangyConversationStateStore({ prisma }).write(
      "conv-1",
      {
        version: LANGY_CONVERSATION_SPINE_VERSION,
        state: {
          ConversationId,
          UserId,
          Title,
          TitleSource: "user",
          Status: "idle",
          IsShared,
          SharedAt,
          SharedById,
          MessageCount,
          LastActivityAt,
          CurrentTurnId,
          LastError,
          PendingHandoffToken,
          PendingHandoffTurnId,
          RunToken,
          ArchivedAt,
        },
      },
      context,
    );

    const call = prisma.langyConversationProjection.upsert.mock.calls[0]?.[0];
    expect(call?.create).toHaveProperty("CreatedAt");
    expect(call?.update).not.toHaveProperty("CreatedAt");
    expect(call?.update).toMatchObject({
      OccurredAt: LastActivityAt,
      ProjectionVersion: LANGY_CONVERSATION_SPINE_VERSION,
    });
  });
});

function turnRow(overrides: Partial<TurnRow> = {}): TurnRow {
  return {
    id: "row-1",
    projectId: "project-1",
    ConversationId: "conv-1",
    TurnId: "turn-1",
    Status: "completed",
    QuestionParts: [{ type: "text", text: "why?" }],
    AnswerParts: [{ type: "text", text: "because" }],
    ToolCalls: [
      { toolCallId: "call-1", toolName: "bash", status: "succeeded" },
    ],
    Plan: [{ content: "read", status: "completed" }],
    Error: null,
    StartedAt: 1_000,
    EndedAt: 1_400,
    CreatedAt: 100,
    UpdatedAt: 2_000,
    OccurredAt: 1_400,
    AcceptedAt: 1_450,
    LastEventId: "event-9",
    ProjectionVersion: LANGY_CONVERSATION_TURN_VERSION,
    ...overrides,
  };
}

describe("the turn store", () => {
  it("splits the fold key back into the conversation and the turn", async () => {
    const prisma = turnPrisma();
    const read = await createLangyConversationTurnStore({ prisma }).read(
      "conv-1:turn-1",
      context,
    );

    expect(
      prisma.langyConversationTurnProjection.findUnique,
    ).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        projectId_ConversationId_TurnId: {
          projectId: "project-1",
          ConversationId: "conv-1",
          TurnId: "turn-1",
        },
      },
    });
    expect(read).toMatchObject({
      kind: "found",
      stored: {
        state: {
          Status: "completed",
          AnswerParts: [{ type: "text", text: "because" }],
        },
      },
    });
  });

  it("writes a missing plan as a JSON null rather than dropping the column", async () => {
    const prisma = turnPrisma();
    await createLangyConversationTurnStore({ prisma }).write(
      "conv-1:turn-1",
      {
        version: LANGY_CONVERSATION_TURN_VERSION,
        state: {
          ConversationId: "conv-1",
          TurnId: "turn-1",
          Status: "running",
          QuestionParts: [],
          AnswerParts: [],
          ToolCalls: [],
          Plan: null,
          Error: null,
          StartedAt: 1_000,
          EndedAt: null,
        },
      },
      context,
    );

    const call =
      prisma.langyConversationTurnProjection.upsert.mock.calls[0]?.[0];
    expect(call?.update).toMatchObject({ Plan: expect.anything() });
    expect(call?.create).toHaveProperty("CreatedAt");
  });

  it("takes OccurredAt from EndedAt when the turn has already terminated", async () => {
    const prisma = turnPrisma();
    await createLangyConversationTurnStore({ prisma }).write(
      "conv-1:turn-1",
      {
        version: LANGY_CONVERSATION_TURN_VERSION,
        state: {
          ConversationId: "conv-1",
          TurnId: "turn-1",
          Status: "completed",
          QuestionParts: [],
          AnswerParts: [],
          ToolCalls: [],
          Plan: null,
          Error: null,
          StartedAt: 1_000,
          EndedAt: 1_400,
        },
      },
      context,
    );

    const call =
      prisma.langyConversationTurnProjection.upsert.mock.calls[0]?.[0];
    expect(call?.update).toMatchObject({ OccurredAt: 1_400 });
  });
});

describe("the message store", () => {
  it("collapses a redelivery onto the message's own identity", async () => {
    const upsert = vi.fn(
      async (_args: Prisma.LangyMessageProjectionUpsertArgs) =>
        ({}) as MessageRow,
    );
    const store = createLangyMessageStore({
      prisma: { langyMessageProjection: { upsert } },
    });

    const record = {
      ConversationId: "conv-1",
      MessageId: "msg-1",
      Role: "user" as const,
      Parts: [],
      SourceEventId: "event-1",
      OccurredAt: 1_000,
      AcceptedAt: 2_000,
      CreatedAt: 1_000,
      UpdatedAt: 1_000,
    };
    await store.writeBatch([record, record], context);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: {
        projectId: "project-1",
        projectId_ConversationId_MessageId: {
          projectId: "project-1",
          ConversationId: "conv-1",
          MessageId: "msg-1",
        },
      },
    });
  });

  it("writes nothing when a delivery produced no message rows", async () => {
    const upsert = vi.fn(
      async (_args: Prisma.LangyMessageProjectionUpsertArgs) =>
        ({}) as MessageRow,
    );
    const store = createLangyMessageStore({
      prisma: { langyMessageProjection: { upsert } },
    });

    await store.writeBatch([], context);

    expect(upsert).not.toHaveBeenCalled();
  });
});
