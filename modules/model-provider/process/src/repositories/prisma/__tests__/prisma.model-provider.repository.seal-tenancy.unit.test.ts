/**
 * The legacy-column sweep under the production tenancy guard, which answers every statement it
 * admits itself so nothing reaches a database.
 * @see modules/model-provider/specs/model-provider.feature
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
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  ModelProviderCredentialCodec,
  type CustomKeysRead,
} from "../../model-provider.repository.ts";
import { PrismaModelProviderRepository } from "../prisma.model-provider.repository.ts";

const UPDATED_AT = new Date("2026-10-09T12:00:00Z");

const ROW = {
  id: "provider-1",
  provider: "openai",
  customKeys: { OPENAI_API_KEY: "plaintext" },
  customModels: null,
  customEmbeddingsModels: null,
  updatedAt: UPDATED_AT,
};

class TenancyGuardOnly extends PrismaQueryGuard {
  readonly admitted: string[] = [];
  readonly #tenancy = PrismaTenancyGuardService.create();

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    void next;

    return this.#tenancy.execute(context, async () => {
      this.admitted.push(context.action);

      return [ROW];
    });
  }
}

class PlainTextCredentials extends ModelProviderCredentialCodec {
  encode(): null {
    return null;
  }

  decode(): CustomKeysRead {
    return { state: "absent", keys: {} };
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
  const repository = PrismaModelProviderRepository.create(
    connection.client,
    new PlainTextCredentials(),
  );

  return { guard, repository };
}

describe("given the Prisma model provider repository behind the tenancy guard", () => {
  describe("when the key seal step reads every project-scoped provider", () => {
    /** @scenario "The key seal sweep reads every provider through the tenancy guard" */
    it("runs the one declared cross-tenant read and returns the stored columns", async () => {
      const { guard, repository } = repositoryBehindTheGuard();

      const rows = await repository.findProjectScopedLegacyColumns();

      expect(rows).toEqual([{ ...ROW, updatedAt: fromDate(UPDATED_AT) }]);
      expect(guard.admitted).toEqual(["queryRaw"]);
    });
  });
});
