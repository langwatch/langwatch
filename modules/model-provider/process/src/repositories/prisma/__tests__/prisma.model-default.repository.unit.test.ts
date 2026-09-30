/**
 * @see specs/model-providers/model-default-config-cascade.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import {
  PrismaModelDefaultRepository,
  WRITE_TX_BUDGET,
} from "../prisma.model-default.repository.ts";

function repositoryOverTransaction() {
  const budgets: unknown[] = [];
  const database = prismaDouble({
    $transaction: (_write: unknown, options: unknown) => {
      budgets.push(options);
      return Promise.resolve(undefined);
    },
  });

  return { budgets, repository: PrismaModelDefaultRepository.create(database) };
}

describe("PrismaModelDefaultRepository write budget", () => {
  const scope = { scopeType: "PROJECT", scopeId: "project-1" } as const;

  describe("when a config is saved", () => {
    /** @scenario "A default-models write queued behind another in the organization is not aborted" */
    it("opens the transaction with a timeout that outlasts the advisory lock queue", async () => {
      const { repository, budgets } = repositoryOverTransaction();

      await repository.save({
        id: "mdcfg-1",
        organizationId: "org-1",
        config: { DEFAULT: "openai/gpt-5-mini" },
        scopes: [scope],
        authorId: null,
      });

      expect(budgets).toEqual([WRITE_TX_BUDGET]);
    });
  });

  describe("when one default is set", () => {
    it("opens the transaction with the same budget", async () => {
      const { repository, budgets } = repositoryOverTransaction();

      await repository.set({
        id: "mdcfg-1",
        organizationId: "org-1",
        scope,
        key: "DEFAULT",
        model: "openai/gpt-5-mini",
        authorId: null,
      });

      expect(budgets).toEqual([WRITE_TX_BUDGET]);
    });
  });
});
