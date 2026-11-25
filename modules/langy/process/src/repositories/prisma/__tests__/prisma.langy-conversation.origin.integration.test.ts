/**
 * @vitest-environment node
 * A conversation's origin against a real Postgres: what the fold stores is what the list
 * reads, and a row written by an image that does not know the column reads as interactive.
 * Spec: modules/langy/specs/langy-unattended-turn.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { initLangyConversationState } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLangyConversationProjectionRepository } from "../prisma.langy-conversation-projection.repository.ts";
import { PrismaLangyConversationRepository } from "../prisma.langy-conversation.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const RUN = `origin-${randomUUID()}`;
const PROJECT_ID = `proj-${RUN}`;
const USER_ID = `ada-${RUN}`;
const AT = Date.UTC(2026, 9, 10, 9, 40);

describe.skipIf(!databaseUrl)(
  "given a run conversation and a chat conversation of one person",
  () => {
    let connection: PrismaConnection;

    beforeAll(async () => {
      if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
      connection = PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
        logger: createLogger("langwatch:langy:origin:test"),
      }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));

      // The run conversation, stored the way the fold stores it.
      await PrismaLangyConversationProjectionRepository.create(connection.client).store(
        {
          state: {
            ...initLangyConversationState(),
            ConversationId: `conv-run-${RUN}`,
            UserId: USER_ID,
            Title: "Daily insights - Costs - 2026-10-09",
            Origin: "run",
            CreatedAt: AT,
            UpdatedAt: AT,
            LastEventOccurredAt: AT,
          },
          cursor: { acceptedAt: AT, eventId: `event-run-${RUN}` },
          occurredAt: AT,
          createdAt: AT,
          updatedAt: AT,
          version: "1",
        },
        { tenantId: createTenantId(PROJECT_ID), aggregateId: `conv-run-${RUN}` },
      );
      // A chat, as an image that does not know the column writes it: no origin at all.
      await connection.client.langyConversationProjection.create({
        data: {
          projectId: PROJECT_ID,
          ConversationId: `conv-chat-${RUN}`,
          UserId: USER_ID,
          TitleSource: "derived",
          Status: "idle",
          CreatedAt: AT - 1_000,
          UpdatedAt: AT - 1_000,
          OccurredAt: AT - 1_000,
          AcceptedAt: AT - 1_000,
          LastEventId: `event-chat-${RUN}`,
          ProjectionVersion: "1",
        },
      });
    });

    afterAll(async () => {
      await connection.client.langyConversationProjection.deleteMany({
        where: { projectId: PROJECT_ID },
      });
      await connection.client.$disconnect();
    });

    describe("when their conversations are listed", () => {
      /** @scenario "A run conversation shows in the person's history as a run" */
      it("reads the run conversation as a run and the chat as interactive", async () => {
        const rows = await PrismaLangyConversationRepository.create(
          connection.client,
        ).findAllForUser({ projectId: PROJECT_ID, userId: USER_ID, limit: 10 });

        expect(new Map(rows.map(({ id, origin }) => [id, origin]))).toEqual(
          new Map([
            [`conv-chat-${RUN}`, "interactive"],
            [`conv-run-${RUN}`, "run"],
          ]),
        );
      });

      it("reads the origin back onto the fold's own state", async () => {
        const read = await PrismaLangyConversationProjectionRepository.create(
          connection.client,
        ).get(`conv-run-${RUN}`, {
          tenantId: createTenantId(PROJECT_ID),
          aggregateId: `conv-run-${RUN}`,
        });

        expect(read.kind === "folded" && read.projection.state.Origin).toBe("run");
      });
    });
  },
);
