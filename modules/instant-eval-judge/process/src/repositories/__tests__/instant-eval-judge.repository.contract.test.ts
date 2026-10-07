import { randomUUID } from "node:crypto";

/**
 * @vitest-environment node
 * The judge's folds, through its service, answer alike over memory and Postgres (ADR-174
 * decisions 13, 17). Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { InstantEvalJudgeFactsService } from "../../services/instant-eval-judge-facts.service.ts";
import type { InstantEvalJudgeRepositories } from "../instant-eval-judge.repositories.ts";
import { MemoryInstantEvalJudgeRepositories } from "../memory/memory.instant-eval-judge.repositories.ts";
import { PostgresInstantEvalJudgeRepositories } from "../prisma/prisma.instant-eval-judge.repositories.ts";

type Backend = Readonly<{
  repositories: () => InstantEvalJudgeRepositories;
  namespace: () => string;
}>;

/** Billing stopped billing the organization; it stamped that fact after saving it, at 100. */
const CHANGE_STAMPED_AT = 100;

function contractCases(backend: Backend): void {
  const facts = () => InstantEvalJudgeFactsService.create({ repositories: backend.repositories() });
  const organizationId = () => `org_${backend.namespace()}`;
  const projectId = () => `project_${backend.namespace()}`;
  const billing = async (service: InstantEvalJudgeFactsService) => {
    const held = await service.getUsageBilling({ organizationId: organizationId() });
    return held.outcome === "folded" ? held.fact.usageBilled : "never folded";
  };

  describe("the project fold", () => {
    it("knows no project before its created fact folds", async () => {
      await expect(facts().getProjectPlacement({ projectId: projectId() })).resolves.toEqual({
        outcome: "unknown",
      });
    });

    it("keeps the first organization when the same created fact folds again", async () => {
      const service = facts();
      const created = { projectId: projectId(), organizationId: organizationId(), occurredAt: 5 };
      await service.projectCreated(created);
      await service.projectCreated(created);
      await service.projectCreated({ ...created, organizationId: "org_other", occurredAt: 9 });

      await expect(service.getProjectPlacement({ projectId: projectId() })).resolves.toEqual({
        outcome: "known",
        organizationId: organizationId(),
      });
    });
  });

  describe("the usage-billing fold", () => {
    it("reads an organization it never folded as never folded", async () => {
      await expect(billing(facts())).resolves.toBe("never folded");
    });

    /** @scenario "A billing change after the catch-up is kept" */
    it("keeps billing's later change over the catch-up's earlier answer", async () => {
      const service = facts();
      await service.usageBillingChanged({
        organizationId: organizationId(),
        usageBilled: true,
        occurredAt: 50,
        fromCatchUp: true,
      });
      await service.usageBillingChanged({
        organizationId: organizationId(),
        usageBilled: false,
        occurredAt: 80,
        fromCatchUp: false,
      });

      await expect(billing(service)).resolves.toBe(false);
    });

    /** @scenario "A catch-up read before a billing change never overrides it" */
    it.each([
      { read: "before", order: "real fact first" },
      { read: "before", order: "catch-up fact first" },
      { read: "after", order: "real fact first" },
      { read: "after", order: "catch-up fact first" },
    ] as const)(
      "reads it as not usage billed when the catch-up read $read the change, $order",
      async ({ read, order }) => {
        const service = facts();
        const realFact = {
          organizationId: organizationId(),
          usageBilled: false,
          occurredAt: CHANGE_STAMPED_AT,
          fromCatchUp: false,
        };
        // A read before the change saw the old answer; a read after it saw the new one.
        const catchUpFact = {
          organizationId: organizationId(),
          usageBilled: read === "before",
          occurredAt: read === "before" ? CHANGE_STAMPED_AT - 30 : CHANGE_STAMPED_AT + 30,
          fromCatchUp: true,
        };
        const folds =
          order === "real fact first" ? [realFact, catchUpFact] : [catchUpFact, realFact];
        for (const fact of folds) await service.usageBillingChanged(fact);

        await expect(billing(service)).resolves.toBe(false);
      },
    );

    it("gives a tie to billing's real fact over a catch-up", async () => {
      const service = facts();
      const at = { organizationId: organizationId(), occurredAt: 70 };
      await service.usageBillingChanged({ ...at, usageBilled: false, fromCatchUp: false });
      await service.usageBillingChanged({ ...at, usageBilled: true, fromCatchUp: true });

      await expect(billing(service)).resolves.toBe(false);
    });
  });

  describe("the spend rows", () => {
    it("sums nothing for an organization with no rows", async () => {
      await expect(facts().getSpendTotal({ organizationId: organizationId() })).resolves.toEqual({
        spendNanoUsd: 0n,
      });
    });

    it("keeps one row per request and never rewrites it", async () => {
      const service = facts();
      const row = {
        organizationId: organizationId(),
        requestId: "request-1",
        spendNanoUsd: 100_000_000n,
        occurredAtMs: 10,
      };

      await expect(service.recordSpend(row)).resolves.toEqual({ outcome: "recorded" });
      await expect(service.recordSpend({ ...row, spendNanoUsd: 999n })).resolves.toEqual({
        outcome: "already_recorded",
      });
      await service.recordSpend({ ...row, requestId: "request-2", spendNanoUsd: 300_000_000n });

      await expect(service.getSpendTotal({ organizationId: organizationId() })).resolves.toEqual({
        spendNanoUsd: 400_000_000n,
      });
    });

    it("sums past what a 32-bit column could hold", async () => {
      const service = facts();
      await service.recordSpend({
        organizationId: organizationId(),
        requestId: "request-large",
        spendNanoUsd: 5_000_000_000n,
        occurredAtMs: 10,
      });

      await expect(service.getSpendTotal({ organizationId: organizationId() })).resolves.toEqual({
        spendNanoUsd: 5_000_000_000n,
      });
    });
  });
}

describe("given the judge's memory repositories", () => {
  let repositories: InstantEvalJudgeRepositories;
  beforeEach(() => {
    repositories = MemoryInstantEvalJudgeRepositories.create();
  });

  contractCases({ repositories: () => repositories, namespace: () => "memory" });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("instant-eval-judge-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the judge's Postgres repositories", () => {
  const namespace = randomUUID();
  const clean = () =>
    cleanupTestRows(database(), [
      ["instantEvalJudgeProject", { projectId: `project_${namespace}` }],
      ["instantEvalJudgeUsageBilling", { organizationId: `org_${namespace}` }],
      ["instantEvalJudgeSpend", { organizationId: `org_${namespace}` }],
    ]);

  beforeEach(clean);
  afterAll(clean);

  contractCases({
    repositories: () => PostgresInstantEvalJudgeRepositories.create({ prisma: database() }),
    namespace: () => namespace,
  });
});
