/**
 * Guardrail writes under the production tenancy guard, which answers every statement it
 * admits itself so nothing reaches a database.
 * @see specs/ai-gateway/governance/guardrails-project-scope.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  PrismaTenancyGuardService,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { PrismaGatewayGuardrailRepository } from "../prisma.gateway-guardrail.repository.ts";

const ROW = {
  id: "guardrail_1",
  projectId: "project_1",
  name: "pii",
  description: null,
  evaluatorId: "evaluator_1",
  direction: "PRE",
  failureMode: "FAIL_CLOSED",
  createdById: "user_1",
  updatedById: "user_1",
  archivedAt: null,
  createdAt: new Date("2026-09-30T00:00:00Z"),
  updatedAt: new Date("2026-09-30T00:00:00Z"),
};

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: string[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;

    return this.#tenancy.execute(context, async () => {
      this.admitted.push(context.action);

      return ROW;
    });
  }
}

function repositoryBehindTheGuard() {
  const guard = new TenancyGuardOnly();
  const connection = PrismaConnectionService.create({
    guard,
    logger: createTestLogger().logger,
  }).connect(
    PrismaConfigService.create().resolve({
      databaseUrl: "postgresql://guard-only@127.0.0.1:1/unreachable",
      log: ["error"],
    }),
  );

  return { guard, repository: PrismaGatewayGuardrailRepository.create(connection.client) };
}

describe("given the Prisma guardrail repository behind the tenancy guard", () => {
  describe("when a guardrail is archived", () => {
    it("is admitted because the write names the guardrail's project", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      await repository.archive({
        id: "guardrail_1",
        projectId: "project_1",
        actorUserId: "user_1",
      });

      expect(guard.admitted).toEqual(["update"]);
    });
  });

  describe("when a guardrail is edited", () => {
    it("is admitted because the write names the guardrail's project", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      await repository.update({
        id: "guardrail_1",
        projectId: "project_1",
        name: "pii strict",
        actorUserId: "user_1",
      });

      expect(guard.admitted).toEqual(["update"]);
    });
  });
});
