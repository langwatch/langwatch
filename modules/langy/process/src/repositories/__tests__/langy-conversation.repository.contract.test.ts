/**
 * @vitest-environment node
 * The turn outcome read stated once and run against the memory twin always, the Postgres one when
 * `LANGWATCH_TEST_DATABASE_URL` is named: owners joined, only failed calls, oldest first, capped.
 * Spec: modules/langy/specs/langy-ops-turn-facts.feature
 */
import { randomUUID } from "node:crypto";

import type { LangyTurnToolCall } from "@langwatch/langy-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { countTurnOutcomes } from "../../rules/langy-turn-facts.rules.ts";
import type { LangyConversationRepository } from "../langy-conversation-projection.repository.ts";
import { LangyMemoryStore } from "../memory/langy-memory.store.ts";
import { MemoryLangyConversationRepository } from "../memory/memory.langy-conversation.repository.ts";
import { PrismaLangyConversationRepository } from "../prisma/prisma.langy-conversation.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const DAY_ONE = Date.parse("2026-11-01T09:00:00Z");
const DAY_TWO = Date.parse("2026-11-02T09:00:00Z");
const SINCE = Date.parse("2026-11-01T00:00:00Z");
const UNTIL = Date.parse("2026-11-03T00:00:00Z");
const MODEL = "openai/gpt-5.4-mini";

type SeedConversation = { projectId: string; conversationId: string; userId: string };
type SeedTurn = {
  projectId: string;
  conversationId: string;
  turnId: string;
  createdAt: number;
  status?: "completed" | "failed";
  error?: string | null;
  toolCalls?: LangyTurnToolCall[];
};
type Seed = { conversations: SeedConversation[]; turns: SeedTurn[] };
type Backend = {
  name: string;
  seeded: (seed: Seed) => Promise<LangyConversationRepository>;
};

const failedTraceCall: LangyTurnToolCall = {
  toolCallId: "call_a",
  toolName: "bash",
  command: 'langwatch trace search --query "ACME secret question"',
  status: "failed",
  errorText: "ACME text that must not leave",
};
const failedReadCall: LangyTurnToolCall = {
  toolCallId: "call_c",
  toolName: "read_file",
  status: "failed",
  errorText: "ACME path that must not leave",
};
const dashboardCall: LangyTurnToolCall = {
  toolCallId: "call_b",
  toolName: "bash",
  command: "langwatch dashboards widget create --dashboard-id dash_open1",
  status: "succeeded",
  durationMs: 900,
};

function memoryBackend(): Backend {
  return {
    name: "memory",
    seeded: async ({ conversations, turns }) => {
      const store = LangyMemoryStore.create();
      const owners = new Map(conversations.map((each) => [each.conversationId, each]));
      for (const each of conversations) {
        store.conversations.set(`${each.projectId}:${each.conversationId}`, {
          projectId: each.projectId,
          projection: stored(conversationState(each)),
        });
      }
      for (const each of turns) {
        if (!owners.has(each.conversationId))
          throw new Error(`no conversation ${each.conversationId}`);
        store.turns.set(`${each.projectId}:${each.conversationId}:${each.turnId}`, {
          projectId: each.projectId,
          projection: { ...stored(turnState(each)), createdAt: each.createdAt },
        });
      }
      return MemoryLangyConversationRepository.create(store);
    },
  };
}

function stored<State>(state: State) {
  return {
    state,
    cursor: { acceptedAt: DAY_ONE, eventId: `evt_${randomUUID()}` },
    occurredAt: DAY_ONE,
    createdAt: DAY_ONE,
    updatedAt: DAY_ONE,
    version: "1",
  };
}

function conversationState({ conversationId, userId }: SeedConversation) {
  return {
    ConversationId: conversationId,
    UserId: userId,
    Title: null,
    TitleSource: "derived" as const,
    Status: "idle" as const,
    IsShared: false,
    SharedAt: null,
    SharedById: null,
    MessageCount: 0,
    LastActivityAt: null,
    CurrentTurnId: null,
    LastError: null,
    LastModel: MODEL,
    Origin: "interactive" as const,
    PendingHandoffToken: null,
    PendingHandoffTurnId: null,
    RunToken: null,
    ArchivedAt: null,
    CiFollowUpsInARow: 0,
    CreatedAt: DAY_ONE,
    UpdatedAt: DAY_ONE,
    LastEventOccurredAt: DAY_ONE,
  };
}

function turnState({
  conversationId,
  turnId,
  createdAt,
  status = "completed",
  error = null,
  toolCalls = [],
}: SeedTurn) {
  return {
    ConversationId: conversationId,
    TurnId: turnId,
    Status: status,
    QuestionParts: [{ type: "text" as const, text: "what did ACME ask" }],
    AnswerParts: [],
    ToolCalls: toolCalls,
    Plan: null,
    Error: error,
    StartedAt: createdAt + 1000,
    EndedAt: createdAt + 5000,
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    LastEventOccurredAt: createdAt,
  };
}

let connection: PrismaConnection | null = null;
const seededProjects: string[] = [];

function postgresBackend(url: string): Backend {
  return {
    name: "postgres",
    seeded: async ({ conversations, turns }) => {
      connection ??= PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
        logger: createTestLogger().logger,
      }).connect(PrismaConfigService.create().resolve({ databaseUrl: url, log: ["error"] }));
      seededProjects.push(...conversations.map((each) => each.projectId));
      await connection.client.langyConversationProjection.createMany({
        data: conversations.map((each) => ({
          projectId: each.projectId,
          ConversationId: each.conversationId,
          UserId: each.userId,
          TitleSource: "derived" as const,
          Status: "idle",
          LastModel: MODEL,
          CreatedAt: DAY_ONE,
          UpdatedAt: DAY_ONE,
          OccurredAt: DAY_ONE,
          AcceptedAt: DAY_ONE,
          LastEventId: `event-${each.conversationId}`,
          ProjectionVersion: "1",
        })),
      });
      await connection.client.langyConversationTurnProjection.createMany({
        data: turns.map((each) => {
          const state = turnState(each);
          return {
            projectId: each.projectId,
            ConversationId: state.ConversationId,
            TurnId: state.TurnId,
            Status: state.Status,
            QuestionParts: state.QuestionParts,
            AnswerParts: state.AnswerParts,
            ToolCalls: state.ToolCalls,
            Error: state.Error,
            StartedAt: state.StartedAt,
            EndedAt: state.EndedAt,
            CreatedAt: each.createdAt,
            UpdatedAt: each.createdAt,
            OccurredAt: each.createdAt,
            AcceptedAt: each.createdAt,
            LastEventId: `event-${each.turnId}`,
            ProjectionVersion: "1",
          };
        }),
      });
      return PrismaLangyConversationRepository.create(connection.client);
    },
  };
}

afterAll(async () => {
  if (!connection) return;
  const projects = { projectId: { in: [...new Set(seededProjects)] } };
  await connection.client.langyConversationTurnProjection.deleteMany({ where: projects });
  await connection.client.langyConversationProjection.deleteMany({ where: projects });
  await connection.client.$disconnect();
});

const backends: readonly Backend[] = [
  memoryBackend(),
  ...(databaseUrl ? [postgresBackend(databaseUrl)] : []),
];

/** Two people's turns over two days in one project, another project's turn, and the edges. */
function twoPeopleSeed(): { seed: Seed; projectId: string } {
  const run = randomUUID();
  const projectId = `proj-outcomes-${run}`;
  const otherProjectId = `proj-outcomes-other-${run}`;
  const ada = `conv-ada-${run}`;
  const kay = `conv-kay-${run}`;
  const other = `conv-other-${run}`;
  return {
    projectId,
    seed: {
      conversations: [
        { projectId, conversationId: ada, userId: `ada-${run}` },
        { projectId, conversationId: kay, userId: `kay-${run}` },
        { projectId: otherProjectId, conversationId: other, userId: `stranger-${run}` },
      ],
      turns: [
        {
          projectId,
          conversationId: ada,
          turnId: "turn-1",
          createdAt: DAY_ONE,
          toolCalls: [dashboardCall],
        },
        {
          projectId,
          conversationId: ada,
          turnId: "turn-2",
          createdAt: DAY_ONE + 60_000,
          status: "failed",
          error: JSON.stringify({ code: "langy_turn_timeout", meta: {} }),
          toolCalls: [dashboardCall, failedTraceCall],
        },
        {
          projectId,
          conversationId: kay,
          turnId: "turn-3",
          createdAt: DAY_ONE + 120_000,
          status: "failed",
          error: "langy_turn_timeout",
          toolCalls: [failedTraceCall],
        },
        {
          projectId,
          conversationId: kay,
          turnId: "turn-4",
          createdAt: DAY_TWO,
          toolCalls: [failedReadCall],
        },
        { projectId, conversationId: kay, turnId: "turn-at-since", createdAt: SINCE },
        { projectId, conversationId: kay, turnId: "turn-at-until", createdAt: UNTIL },
        {
          projectId: otherProjectId,
          conversationId: other,
          turnId: "turn-other",
          createdAt: DAY_ONE,
        },
      ],
    },
  };
}

describe.each(backends)("given Langy turns in the $name tier", ({ seeded }) => {
  let repository: LangyConversationRepository;
  let projectId: string;
  const readWith = (limit: number) =>
    repository.findTurnOutcomeRows({ projectIds: [projectId], since: SINCE, until: UNTIL, limit });

  beforeEach(async () => {
    const world = twoPeopleSeed();
    projectId = world.projectId;
    repository = await seeded(world.seed);
  });

  describe("when the outcomes of a window are read", () => {
    it("joins each turn's owner and model, keeps [since, until) and this project only", async () => {
      const read = await readWith(100);

      expect(read.truncated).toBe(false);
      expect(countTurnOutcomes(read.rows)).toEqual([
        {
          day: "2026-11-01",
          model: MODEL,
          turnState: "completed",
          failureCode: null,
          toolErrorsByTool: {},
          turns: 2,
          users: 2,
        },
        {
          day: "2026-11-01",
          model: MODEL,
          turnState: "failed",
          failureCode: "langy_turn_timeout",
          toolErrorsByTool: { "langwatch.trace": 2 },
          turns: 2,
          users: 2,
        },
        {
          day: "2026-11-02",
          model: MODEL,
          turnState: "completed",
          failureCode: null,
          toolErrorsByTool: { read_file: 1 },
          turns: 1,
          users: 1,
        },
      ]);
    });

    it("carries only the failed calls, each as its tool name and command", async () => {
      const read = await readWith(100);

      expect(read.rows.map((row) => row.failedToolCalls)).toEqual([
        [],
        [],
        [{ toolName: "bash", command: failedTraceCall.command }],
        [{ toolName: "bash", command: failedTraceCall.command }],
        [{ toolName: "read_file" }],
      ]);
      expect(JSON.stringify(read.rows)).not.toContain("must not leave");
    });
  });

  describe("when the window holds more turns than the cap", () => {
    it("answers the oldest turns up to the cap and marks the read truncated", async () => {
      const read = await readWith(2);

      expect(read.truncated).toBe(true);
      expect(read.rows.map((row) => row.createdAt)).toEqual([SINCE, DAY_ONE]);
    });

    it("is not truncated when the window holds exactly the cap", async () => {
      const read = await readWith(5);

      expect(read).toMatchObject({ truncated: false });
      expect(read.rows).toHaveLength(5);
    });
  });
});
