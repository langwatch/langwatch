/**
 * @vitest-environment node
 * The memory tier's database rows answer the way the Postgres ones do: a
 * row a fold stored is the row a read answers with, and admission keeps one
 * active turn per conversation. Postgres joins where `LANGWATCH_TEST_DATABASE_URL` is set.
 */
import { randomUUID } from "node:crypto";

import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import {
  LANGY_RUN_CONVERSATION_IDS_LIMIT,
  type LangyConversationStateData,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type { LangyDatabaseRepositories } from "../langy-repositories.registry.ts";
import { MemoryLangyRepositories } from "../memory/memory.langy.repositories.ts";
import { PrismaLangyRepositories } from "../prisma/prisma.langy.repositories.ts";

function contextFor(conversationId: string, key?: string): ProjectionStoreContext {
  return {
    tenantId: createTenantId("proj_1"),
    aggregateId: conversationId,
    ...(key ? { key } : {}),
  };
}

function conversation(overrides: Partial<LangyConversationStateData>): LangyConversationStateData {
  return {
    ConversationId: "",
    UserId: "user_1",
    Title: null,
    TitleSource: "default" as LangyConversationStateData["TitleSource"],
    Status: "idle",
    IsShared: false,
    SharedAt: null,
    SharedById: null,
    MessageCount: 0,
    LastActivityAt: null,
    CurrentTurnId: null,
    LastError: null,
    LastModel: null,
    Origin: "interactive",
    PendingHandoffToken: null,
    PendingHandoffTurnId: null,
    RunToken: null,
    ArchivedAt: null,
    CreatedAt: 1_000,
    UpdatedAt: 1_000,
    LastEventOccurredAt: 1_000,
    ...overrides,
  };
}

async function storeConversation(
  repositories: ReturnType<typeof MemoryLangyRepositories.create>,
  conversationId: string,
  state: Partial<LangyConversationStateData>,
): Promise<void> {
  await repositories.conversationState.store(
    {
      state: conversation(state),
      cursor: { acceptedAt: 1_000, eventId: `evt_${conversationId}` },
      occurredAt: 1_000,
      createdAt: 1_000,
      updatedAt: 1_000,
      version: "v1",
    },
    contextFor(conversationId),
  );
}

describe("given the memory tier's database rows", () => {
  describe("when a fold stores a conversation", () => {
    it("is the row the conversation reads answer with", async () => {
      const repositories = MemoryLangyRepositories.create();
      await storeConversation(repositories, "conv_a", { Title: "Alpha", LastActivityAt: 5 });
      await storeConversation(repositories, "conv_b", { Title: "Beta", LastActivityAt: 9 });
      await storeConversation(repositories, "conv_c", { UserId: "user_2" });

      const visible = await repositories.conversations.getVisibleById({
        id: "conv_a",
        projectId: "proj_1",
        userId: "user_1",
      });
      const listed = await repositories.conversations.findAllForUser({
        projectId: "proj_1",
        userId: "user_1",
        limit: 10,
      });

      expect(visible).toMatchObject({ id: "conv_a", title: "Alpha", lastActivityAtMs: 5 });
      expect(listed.map((row) => row.id)).toEqual(["conv_b", "conv_a"]);
      expect(
        await repositories.conversations.findOwnership({
          id: "conv_c",
          projectId: "proj_1",
          userId: "user_1",
        }),
      ).toBe("other");
    });
  });

  describe("when a send is admitted", () => {
    it("records the receipt and refuses a second turn on the conversation", async () => {
      const repositories = MemoryLangyRepositories.create();
      const send = {
        projectId: "proj_1",
        userId: "user_1",
        conversationId: "conv_a",
      };

      const first = await repositories.admission.claim({
        ...send,
        idempotencyKey: "idem_1",
        turnId: "turn_1",
      });
      const second = await repositories.admission.claim({
        ...send,
        idempotencyKey: "idem_2",
        turnId: "turn_2",
      });
      const reused = await repositories.admission.claim({
        ...send,
        idempotencyKey: "idem_1",
        turnId: "turn_other",
      });

      expect(first.kind).toBe("claimed");
      expect(second.kind).toBe("busy");
      expect(reused.kind).toBe("mismatch");
      expect(await repositories.conversations.hasAdmittedTurn(send)).toBe(true);
    });

    it("replays a committed send under the same key", async () => {
      const repositories = MemoryLangyRepositories.create();
      const send = {
        projectId: "proj_1",
        userId: "user_1",
        conversationId: "conv_a",
        idempotencyKey: "idem_1",
        turnId: "turn_1",
      };
      const claim = await repositories.admission.claim(send);
      if (claim.kind !== "claimed") throw new Error("expected a claim");
      await repositories.admission.commit({ ...send, claimToken: claim.claimToken });

      expect(await repositories.admission.claim(send)).toEqual({
        kind: "replay",
        conversationId: "conv_a",
        turnId: "turn_1",
      });
    });
  });

  describe("when the message map appends a message", () => {
    it("is read back in creation order", async () => {
      const repositories = MemoryLangyRepositories.create();
      const base = {
        ConversationId: "conv_a",
        Role: "user" as const,
        Parts: [{ type: "text" as const, text: "hello" }],
        SourceEventId: "evt_1",
        OccurredAt: 1,
        AcceptedAt: 1,
        UpdatedAt: 1,
      };
      await repositories.messageStorage.append(
        { ...base, MessageId: "msg_2", CreatedAt: 20 },
        contextFor("conv_a"),
      );
      await repositories.messageStorage.append(
        { ...base, MessageId: "msg_1", CreatedAt: 10 },
        contextFor("conv_a"),
      );

      const messages = await repositories.messages.findAllByConversation({
        conversationId: "conv_a",
        projectId: "proj_1",
      });

      expect(messages.map((message) => message.id)).toEqual(["msg_1", "msg_2"]);
    });
  });
});

type RunConversationFixture = Readonly<{
  repositories: Pick<LangyDatabaseRepositories, "conversations" | "conversationState">;
  projectId: string;
  otherProjectId: string;
  close: () => Promise<void>;
}>;

const DATABASE_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const SINCE = Date.UTC(2026, 9, 19, 6);
let connection: PrismaConnection | undefined;

afterAll(async () => {
  await connection?.client.$disconnect();
});

function projectIds(): { projectId: string; otherProjectId: string } {
  const run = randomUUID();
  return { projectId: `proj-run-${run}`, otherProjectId: `proj-other-${run}` };
}

const backends = [
  {
    name: "memory",
    skip: false,
    open: async (): Promise<RunConversationFixture> => ({
      repositories: MemoryLangyRepositories.create(),
      ...projectIds(),
      close: async () => {},
    }),
  },
  {
    name: "postgres",
    skip: !DATABASE_URL,
    open: async (): Promise<RunConversationFixture> => {
      connection ??= PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
        logger: createLogger("langwatch:langy:run-conversations:test"),
      }).connect(
        PrismaConfigService.create().resolve({ databaseUrl: DATABASE_URL ?? "", log: ["error"] }),
      );
      const client = connection.client;
      const ids = projectIds();
      return {
        repositories: PrismaLangyRepositories.create(client),
        ...ids,
        close: async () => {
          await client.langyConversationProjection.deleteMany({
            where: { projectId: { in: [ids.projectId, ids.otherProjectId] } },
          });
        },
      };
    },
  },
];

/** Stores one conversation the way the fold does; `createdAt` is the row's opening time. */
async function storeAt({
  fixture,
  conversationId,
  createdAt,
  projectId = fixture.projectId,
  state,
}: {
  fixture: RunConversationFixture;
  conversationId: string;
  createdAt: number;
  projectId?: string;
  state: Partial<LangyConversationStateData>;
}): Promise<void> {
  await fixture.repositories.conversationState.store(
    {
      state: conversation({
        ConversationId: conversationId,
        TitleSource: "derived",
        Origin: "run",
        CreatedAt: createdAt,
        ...state,
      }),
      cursor: { acceptedAt: createdAt, eventId: `evt_${conversationId}` },
      occurredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      version: "v1",
    },
    { tenantId: createTenantId(projectId), aggregateId: conversationId },
  );
}

function findSince(fixture: RunConversationFixture): Promise<string[]> {
  return fixture.repositories.conversations.findRunConversationIds({
    projectId: fixture.projectId,
    since: SINCE,
  });
}

describe.each(backends)("given run conversations on the $name backend", (backend) => {
  let opened: RunConversationFixture | undefined;
  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });
  const open = async () => {
    opened = await backend.open();
    return opened;
  };
  const LONG_AGO = SINCE - 100_000;

  describe.skipIf(backend.skip)(
    "when the project's run conversations since a time are found",
    () => {
      /** @scenario "The run conversations active since a time are found by id, newest first" */
      it("answers its run conversations active since then, newest first, and nothing else", async () => {
        const fixture = await open();
        const at = (conversationId: string, state: Partial<LangyConversationStateData>) =>
          storeAt({ fixture, conversationId, createdAt: LONG_AGO, state });
        await at("conv_run_before", { LastActivityAt: SINCE - 1 });
        await at("conv_run_edge", { LastActivityAt: SINCE });
        await at("conv_run_a", { LastActivityAt: SINCE + 5 });
        await at("conv_run_b", { LastActivityAt: SINCE + 9 });
        await at("conv_chat", { Origin: "interactive", LastActivityAt: SINCE + 20 });
        await storeAt({
          fixture,
          conversationId: "conv_run_elsewhere",
          createdAt: LONG_AGO,
          projectId: fixture.otherProjectId,
          state: { LastActivityAt: SINCE + 20 },
        });

        expect(await findSince(fixture)).toEqual(["conv_run_b", "conv_run_a", "conv_run_edge"]);
      });

      /** @scenario "A run conversation opened since the time with no activity yet is found first" */
      it("answers one opened since then with no activity yet, ahead of the active ones", async () => {
        const fixture = await open();
        await storeAt({
          fixture,
          conversationId: "conv_run_active",
          createdAt: LONG_AGO,
          state: { LastActivityAt: SINCE + 5 },
        });
        await storeAt({
          fixture,
          conversationId: "conv_run_fresh",
          createdAt: SINCE + 1,
          state: { LastActivityAt: null },
        });
        await storeAt({
          fixture,
          conversationId: "conv_run_unstamped_old",
          createdAt: SINCE - 1,
          state: { LastActivityAt: null },
        });

        expect(await findSince(fixture)).toEqual(["conv_run_fresh", "conv_run_active"]);
      });

      /** @scenario "An archived run conversation is still found" */
      it("answers an archived one, because its traces remain", async () => {
        const fixture = await open();
        await storeAt({
          fixture,
          conversationId: "conv_run_archived",
          createdAt: LONG_AGO,
          state: { LastActivityAt: SINCE + 5, ArchivedAt: SINCE + 6 },
        });

        expect(await findSince(fixture)).toEqual(["conv_run_archived"]);
      });
    },
  );
});

// Memory only: a thousand and one Postgres upserts would buy no more than the take above shows.
describe("given more run conversations since a time than the cap, in the memory tier", () => {
  describe("when the project's run conversations since that time are found", () => {
    /** @scenario "At most a thousand run conversation ids are answered" */
    it("answers the newest LANGY_RUN_CONVERSATION_IDS_LIMIT of them", async () => {
      const fixture = await backends[0]!.open();
      for (let index = 0; index <= LANGY_RUN_CONVERSATION_IDS_LIMIT; index++) {
        await storeAt({
          fixture,
          conversationId: `conv_run_${index}`,
          createdAt: SINCE,
          state: { LastActivityAt: SINCE + index },
        });
      }

      const found = await findSince(fixture);

      expect(LANGY_RUN_CONVERSATION_IDS_LIMIT).toBe(1_000);
      expect(found).toHaveLength(1_000);
      expect(found[0]).toBe("conv_run_1000");
      expect(found).not.toContain("conv_run_0");
    });
  });
});
