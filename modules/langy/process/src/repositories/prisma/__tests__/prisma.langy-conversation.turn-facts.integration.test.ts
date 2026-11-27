/**
 * @vitest-environment node
 * Langy's turn facts for the ops functions against a real Postgres.
 * Spec: modules/langy/specs/langy-ops-turn-facts.feature
 */
import { randomUUID } from "node:crypto";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { countTurnOutcomes, turnFactsOf } from "../../../rules/langy-turn-facts.rules.ts";
import { PrismaLangyConversationRepository } from "../prisma.langy-conversation.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `facts-${randomUUID()}`;
const PROJECT_ID = `proj-${RUN}`;
const OTHER_PROJECT_ID = `proj-other-${RUN}`;
const DAY_ONE = Date.parse("2026-11-01T09:00:00Z");
const DAY_TWO = Date.parse("2026-11-02T09:00:00Z");
const LATER = Date.parse("2026-11-20T09:00:00Z");

function conversation({
  conversationId,
  userId,
  projectId = PROJECT_ID,
}: {
  conversationId: string;
  userId: string;
  projectId?: string;
}) {
  return {
    projectId,
    ConversationId: conversationId,
    UserId: userId,
    TitleSource: "derived" as const,
    Status: "idle",
    LastModel: "openai/gpt-5.4-mini",
    CreatedAt: DAY_ONE,
    UpdatedAt: DAY_ONE,
    OccurredAt: DAY_ONE,
    AcceptedAt: DAY_ONE,
    LastEventId: `event-${conversationId}`,
    ProjectionVersion: "1",
  };
}

function turn({
  conversationId,
  turnId,
  createdAt,
  status = "completed",
  error = null,
  toolCalls = [],
  projectId = PROJECT_ID,
}: {
  conversationId: string;
  turnId: string;
  createdAt: number;
  status?: string;
  error?: string | null;
  toolCalls?: object[];
  projectId?: string;
}) {
  return {
    projectId,
    ConversationId: conversationId,
    TurnId: turnId,
    Status: status,
    QuestionParts: [{ type: "text", text: "what did ACME ask" }],
    AnswerParts: [],
    ToolCalls: toolCalls,
    Error: error,
    StartedAt: createdAt + 1000,
    EndedAt: createdAt + 5000,
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    OccurredAt: createdAt,
    AcceptedAt: createdAt,
    LastEventId: `event-${turnId}`,
    ProjectionVersion: "1",
  };
}

const failedTraceCall = {
  toolCallId: "call_a",
  toolName: "bash",
  command: 'langwatch trace search --query "ACME secret question"',
  status: "failed",
  errorText: "ACME text that must not leave",
};
const dashboardCall = {
  toolCallId: "call_b",
  toolName: "bash",
  command: "langwatch dashboards widget create --dashboard-id dash_open1",
  status: "succeeded",
  durationMs: 900,
};

describe.skipIf(!databaseUrl)("given Langy turns in two projects", () => {
  let connection: PrismaConnection;
  let repository: PrismaLangyConversationRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createTestLogger().logger,
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaLangyConversationRepository.create(connection.client);

    await connection.client.langyConversationProjection.createMany({
      data: [
        conversation({ conversationId: `conv-ada-${RUN}`, userId: `ada-${RUN}` }),
        conversation({ conversationId: `conv-kay-${RUN}`, userId: `kay-${RUN}` }),
        conversation({
          conversationId: `conv-other-${RUN}`,
          userId: `stranger-${RUN}`,
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    });
    await connection.client.langyConversationTurnProjection.createMany({
      data: [
        turn({
          conversationId: `conv-ada-${RUN}`,
          turnId: `turn-1-${RUN}`,
          createdAt: DAY_ONE,
          toolCalls: [dashboardCall],
        }),
        turn({
          conversationId: `conv-ada-${RUN}`,
          turnId: `turn-2-${RUN}`,
          createdAt: DAY_ONE + 60_000,
          status: "failed",
          error: JSON.stringify({ code: "langy_turn_timeout", meta: {} }),
          toolCalls: [failedTraceCall],
        }),
        turn({
          conversationId: `conv-kay-${RUN}`,
          turnId: `turn-3-${RUN}`,
          createdAt: DAY_ONE + 120_000,
          status: "failed",
          error: "langy_turn_timeout",
          toolCalls: [failedTraceCall],
        }),
        turn({ conversationId: `conv-kay-${RUN}`, turnId: `turn-4-${RUN}`, createdAt: DAY_TWO }),
        turn({ conversationId: `conv-kay-${RUN}`, turnId: `turn-5-${RUN}`, createdAt: LATER }),
        turn({
          conversationId: `conv-other-${RUN}`,
          turnId: `turn-other-${RUN}`,
          createdAt: DAY_ONE,
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

  describe("when the outcomes are counted for a window", () => {
    /** @scenario "Turn outcomes are counted per day, model, state and failure code over real Postgres" */
    it("groups turns by day, model, state and code, with owners and failed tool calls", async () => {
      const { rows, truncated } = await repository.findTurnOutcomeRows({
        projectIds: [PROJECT_ID],
        since: Date.parse("2026-11-01T00:00:00Z"),
        until: Date.parse("2026-11-03T00:00:00Z"),
        limit: 100,
      });
      const counts = countTurnOutcomes(rows);

      expect(truncated).toBe(false);

      expect(counts).toEqual([
        {
          day: "2026-11-01",
          model: "openai/gpt-5.4-mini",
          turnState: "completed",
          failureCode: null,
          toolErrorsByTool: {},
          turns: 1,
          users: 1,
        },
        {
          day: "2026-11-01",
          model: "openai/gpt-5.4-mini",
          turnState: "failed",
          failureCode: "langy_turn_timeout",
          toolErrorsByTool: { "langwatch.trace": 2 },
          turns: 2,
          users: 2,
        },
        {
          day: "2026-11-02",
          model: "openai/gpt-5.4-mini",
          turnState: "completed",
          failureCode: null,
          toolErrorsByTool: {},
          turns: 1,
          users: 1,
        },
      ]);
      expect(JSON.stringify(counts)).not.toContain("ACME");
    });
  });

  describe("when one conversation's turn facts are read", () => {
    /** @scenario "One conversation's turn facts are read over real Postgres" */
    it("answers its turns in order with codes and targets, and no text", async () => {
      const rows = await repository.findConversationTurnFactRows({
        projectId: PROJECT_ID,
        conversationId: `conv-ada-${RUN}`,
      });
      const facts = rows.map(turnFactsOf);

      expect(facts).toEqual([
        {
          turnId: `turn-1-${RUN}`,
          state: "completed",
          failureCode: null,
          createdAt: DAY_ONE,
          startedAt: DAY_ONE + 1000,
          endedAt: DAY_ONE + 5000,
          toolCalls: [
            {
              tool: "langwatch.dashboards",
              status: "succeeded",
              durationMs: 900,
              waitKind: null,
              targetKind: "dashboard",
              targetId: "dash_open1",
            },
          ],
        },
        expect.objectContaining({
          turnId: `turn-2-${RUN}`,
          state: "failed",
          failureCode: "langy_turn_timeout",
        }),
      ]);
      expect(JSON.stringify(facts)).not.toContain("ACME");
    });

    /** @scenario "One conversation's turn facts are read over real Postgres" */
    it("holds no conversation another project owns", async () => {
      const exists = (conversationId: string) =>
        repository.conversationExists({ projectId: PROJECT_ID, conversationId });

      await expect(exists(`conv-ada-${RUN}`)).resolves.toBe(true);
      await expect(exists(`conv-other-${RUN}`)).resolves.toBe(false);
    });
  });
});
