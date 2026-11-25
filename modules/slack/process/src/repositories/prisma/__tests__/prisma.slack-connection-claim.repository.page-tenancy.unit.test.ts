/**
 * The claim page under the production tenancy guard, which answers every statement it admits
 * itself so nothing reaches a database.
 * @see modules/slack/specs/slack-connections.feature
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

import { PrismaSlackConnectionClaimRepository } from "../prisma.slack-connection-claim.repository.ts";

const CLAIMS = [
  {
    connectionId: "connection-a",
    claimantId: "trigger-1",
    claimantLabel: "Alerts",
    organizationId: "organization-1",
    projectId: "project-1",
  },
  {
    connectionId: "connection-b",
    claimantId: "trigger-2",
    claimantLabel: "Digest",
    organizationId: "organization-2",
    projectId: "project-2",
  },
];

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: string[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;

    return this.#tenancy.execute(context, async () => {
      this.admitted.push(context.action);

      return CLAIMS;
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

  return { guard, repository: PrismaSlackConnectionClaimRepository.create(connection.client) };
}

describe("given the Prisma Slack claim repository behind the tenancy guard", () => {
  describe("when the claimant's release sweep reads a page of every organisation's claims", () => {
    /** @scenario "A claim page reads every organisation's claims through the tenancy guard" */
    it("runs the one declared cross-tenant read and returns each claim", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      const page = await repository.findPage({
        after: { connectionId: "connection-0", claimantId: "trigger-0" },
        limit: 500,
      });

      expect(page).toEqual(CLAIMS);
      expect(guard.admitted).toEqual(["queryRaw"]);
    });
  });
});
