/**
 * The replay step's project walk under the production tenancy guard, which answers every
 * statement it admits itself so nothing reaches a database.
 * @see modules/suite/specs/suite-run-replay.feature
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

import { PrismaSuiteRepository } from "../prisma.suite.repository.ts";

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: string[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;

    return this.#tenancy.execute(context, async () => {
      this.admitted.push(context.action);

      return [{ projectId: "project-1" }, { projectId: "project-2" }];
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

  return { guard, repository: PrismaSuiteRepository.create(connection.client) };
}

describe("given the Prisma suite repository behind the tenancy guard", () => {
  describe("when the replay step lists the projects holding suites", () => {
    /** @scenario "The replay reads every project holding suites through the tenancy guard" */
    it("runs the one declared cross-tenant read and returns each project once", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      const projectIds = await repository.findProjectIdsHoldingSuites();

      expect(projectIds).toEqual(["project-1", "project-2"]);
      expect(guard.admitted).toEqual(["queryRaw"]);
    });
  });
});
