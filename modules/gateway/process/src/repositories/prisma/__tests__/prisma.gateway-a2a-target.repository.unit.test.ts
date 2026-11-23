/** The Postgres side of the A2A target registry: a live-name index violation is a coded refusal. */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaGatewayA2aTargetRepository } from "../prisma.gateway-a2a-target.repository.ts";

const input = {
  organizationId: "org_1",
  projectId: null,
  name: "billing",
  agentName: "Billing agent",
  cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
  upstreamUrl: "https://billing.acme.test/a2a",
  actorUserId: "user_1",
};

const cipher = { encrypt: (text: string) => text, decrypt: (text: string) => text };

function repositoryRejectingCreate(error: unknown) {
  const prisma = prismaDouble({
    gatewayA2ATarget: { create: () => Promise.reject(error) },
  });
  return PrismaGatewayA2aTargetRepository.create({ prisma, cipher });
}

describe("PrismaGatewayA2aTargetRepository", () => {
  describe("when the live-name index refuses the insert", () => {
    it("refuses with the name-taken code", async () => {
      const repository = repositoryRejectingCreate(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

      await expect(repository.create(input)).rejects.toMatchObject({
        code: "gateway_a2a_target_name_taken",
      });
    });
  });

  describe("when the insert fails for another reason", () => {
    it("passes the error through", async () => {
      const failure = new Error("connection reset");
      const repository = repositoryRejectingCreate(failure);

      await expect(repository.create(input)).rejects.toBe(failure);
    });
  });
});
