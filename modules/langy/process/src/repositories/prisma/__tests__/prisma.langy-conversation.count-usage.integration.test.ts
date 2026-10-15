/**
 * @vitest-environment node
 * Langy's usage figures against a real Postgres, windowed on epoch milliseconds.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLangyConversationRepository } from "../prisma.langy-conversation.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `usage-${randomUUID()}`;
const PROJECT_ID = `proj-${RUN}`;
/** Another install's project, which no count may reach. */
const OTHER_PROJECT_ID = `proj-other-${RUN}`;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const THREE_DAYS_AGO = NOW - 3 * DAY;
const TWENTY_DAYS_AGO = NOW - 20 * DAY;
const FORTY_DAYS_AGO = NOW - 40 * DAY;

/** A conversation projection row with the columns Postgres insists on. */
function conversation({
  conversationId,
  userId,
  createdAt,
  lastActivityAt,
  projectId = PROJECT_ID,
}: {
  conversationId: string;
  userId: string;
  createdAt: number;
  lastActivityAt: number | null;
  projectId?: string;
}) {
  return {
    projectId,
    ConversationId: conversationId,
    UserId: userId,
    TitleSource: "derived" as const,
    Status: "idle",
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    OccurredAt: createdAt,
    AcceptedAt: createdAt,
    LastActivityAt: lastActivityAt,
    LastEventId: `event-${conversationId}`,
    ProjectionVersion: "1",
  };
}

/** A turn projection row, stamped in epoch milliseconds like the fold does. */
function turn({
  conversationId,
  turnId,
  createdAt,
  projectId = PROJECT_ID,
}: {
  conversationId: string;
  turnId: string;
  createdAt: number;
  projectId?: string;
}) {
  return {
    projectId,
    ConversationId: conversationId,
    TurnId: turnId,
    Status: "completed",
    QuestionParts: [],
    AnswerParts: [],
    ToolCalls: [],
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    OccurredAt: createdAt,
    AcceptedAt: createdAt,
    LastEventId: `event-${turnId}`,
    ProjectionVersion: "1",
  };
}

describe.skipIf(!databaseUrl)("given Langy conversations and turns, some of them old", () => {
  let connection: PrismaConnection;
  let repository: PrismaLangyConversationRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:usage-report:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaLangyConversationRepository.create(connection.client);

    // Ada has two conversations, one active this week and one long idle; Kay
    // one from twenty days ago; a stranger's install has one of its own.
    await connection.client.langyConversationProjection.createMany({
      data: [
        conversation({
          conversationId: `conv-ada-1-${RUN}`,
          userId: `ada-${RUN}`,
          createdAt: FORTY_DAYS_AGO,
          lastActivityAt: THREE_DAYS_AGO,
        }),
        conversation({
          conversationId: `conv-ada-2-${RUN}`,
          userId: `ada-${RUN}`,
          createdAt: FORTY_DAYS_AGO,
          lastActivityAt: FORTY_DAYS_AGO,
        }),
        conversation({
          conversationId: `conv-kay-${RUN}`,
          userId: `kay-${RUN}`,
          createdAt: TWENTY_DAYS_AGO,
          lastActivityAt: null,
        }),
        conversation({
          conversationId: `conv-other-${RUN}`,
          userId: `stranger-${RUN}`,
          createdAt: THREE_DAYS_AGO,
          lastActivityAt: THREE_DAYS_AGO,
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    });
    await connection.client.langyConversationTurnProjection.createMany({
      data: [
        turn({
          conversationId: `conv-ada-1-${RUN}`,
          turnId: `turn-1-${RUN}`,
          createdAt: FORTY_DAYS_AGO,
        }),
        turn({
          conversationId: `conv-ada-1-${RUN}`,
          turnId: `turn-2-${RUN}`,
          createdAt: THREE_DAYS_AGO,
        }),
        turn({
          conversationId: `conv-kay-${RUN}`,
          turnId: `turn-3-${RUN}`,
          createdAt: TWENTY_DAYS_AGO,
        }),
        turn({
          conversationId: `conv-other-${RUN}`,
          turnId: `turn-other-${RUN}`,
          createdAt: THREE_DAYS_AGO,
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    });
  });

  afterAll(async () => {
    const projects = { projectId: { in: [PROJECT_ID, OTHER_PROJECT_ID] } };
    await connection.client.langyConversationTurnProjection.deleteMany({ where: projects });
    await connection.client.langyConversationProjection.deleteMany({ where: projects });
    await connection.client.$disconnect();
  });

  describe("when the usage is counted", () => {
    /** @scenario "Langy turns and the people sending them are counted" */
    it("counts turns by the fold's millisecond stamp and people by their last activity", async () => {
      const count = (since?: number) =>
        repository.countUsage({
          projectIds: [PROJECT_ID],
          ...(since === undefined ? {} : { since }),
        });

      await expect(count()).resolves.toMatchObject({ turns: 3, activeUsers: 2 });
      await expect(count(NOW - 7 * DAY)).resolves.toMatchObject({ turns: 1, activeUsers: 1 });
      await expect(count(NOW - 28 * DAY)).resolves.toMatchObject({ turns: 2, activeUsers: 2 });
    });

    /** @scenario "Langy turns and the people sending them are counted" */
    it("dates the first turn from the oldest one", async () => {
      await expect(repository.countUsage({ projectIds: [PROJECT_ID] })).resolves.toMatchObject({
        firstTurnAt: FORTY_DAYS_AGO,
      });
    });
  });
});
