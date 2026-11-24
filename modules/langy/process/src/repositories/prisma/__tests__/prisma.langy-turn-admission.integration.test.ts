/**
 * @vitest-environment node
 * Turn admission against a real Postgres: a send refused while another turn holds the
 * conversation names that turn, so the caller can tell a turn still replying from one that ended.
 * Spec: specs/langy/langy-turn-recovery.feature
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

import { PrismaLangyTurnAdmissionRepository } from "../prisma.langy-turn-admission.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const RUN = `admission-${randomUUID()}`;
const PROJECT_ID = `proj-${RUN}`;
const CONVERSATION_ID = `conv-${RUN}`;

describe.skipIf(!databaseUrl)("given a conversation whose turn holds admission", () => {
  let connection: PrismaConnection;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:langy:admission:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
  });

  afterAll(async () => {
    await connection.client.langyActiveTurn.deleteMany({ where: { projectId: PROJECT_ID } });
    await connection.client.langyTurnRequest.deleteMany({ where: { projectId: PROJECT_ID } });
    await connection.client.$disconnect();
  });

  describe("when a second send asks for the conversation", () => {
    /** @scenario A message sent right after a reply ends waits for the reply to be saved */
    it("refuses it as busy and names the turn holding the conversation", async () => {
      const admission = PrismaLangyTurnAdmissionRepository.create(connection.client);
      const send = { projectId: PROJECT_ID, userId: "user-1", conversationId: CONVERSATION_ID };

      const first = await admission.claim({ ...send, idempotencyKey: "idem-1", turnId: "turn-1" });
      const second = await admission.claim({ ...send, idempotencyKey: "idem-2", turnId: "turn-2" });

      expect(first.kind).toBe("claimed");
      expect(second).toEqual({
        kind: "busy",
        conversationId: CONVERSATION_ID,
        heldTurnId: "turn-1",
      });
    });
  });
});
