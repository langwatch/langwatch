/**
 * Pure-logic unit test for the OTHER exhaustion cause the resolver must
 * keep distinct from a restricted-model refusal (issue #6634, Gap 1, AC-G2):
 * a `<provider>/latest` alias that cannot resolve to any concrete model in
 * the current catalog. Conflating the two would tell a user to change a
 * model-restriction setting that isn't their actual problem — see
 * specs/model-providers/model-default-config-cascade.feature ("Exhaustion
 * caused by an unresolvable latest-alias still reports 'nothing
 * configured'").
 *
 * The real catalog always resolves a live `<provider>/latest` for the
 * providers `resolveLatestAlias` supports, so this file mocks
 * `../latestAliases` to force the unresolvable branch deterministically —
 * asserting against the live catalog's current contents would be brittle
 * (the catalog changes independently of this behavior) and could pass or
 * fail for the wrong reason as models are added/retired.
 */

import { describe, expect, it, vi } from "vitest";
import type { ModelDefaultScopeType, PrismaClient } from "~/generated/prisma/client";

const UNRESOLVABLE_ALIAS = "openai/latest";

vi.mock("@langwatch/model-provider-contract", async (importOriginal) => {
  const contract =
    await importOriginal<typeof import("@langwatch/model-provider-contract")>();
  return {
    ...contract,
    isLatestAlias: (model: string) => model === UNRESOLVABLE_ALIAS,
    expandLatestAlias: (model: string) => model,
  };
});

import { ModelNotConfiguredError } from "../modelNotConfiguredError";
import { resolveModelForFeature } from "../resolveModelForFeature";

interface ScopeRow {
  scopeType: ModelDefaultScopeType;
  scopeId: string;
}

function fakePrisma(configJson: Record<string, string>): PrismaClient {
  const project = {
    id: "proj-1",
    teamId: "team-1",
    team: { id: "team-1", organizationId: "org-1" },
  };
  const scopes: ScopeRow[] = [{ scopeType: "PROJECT", scopeId: "proj-1" }];
  return {
    project: {
      findUnique: async () => project,
    },
    modelDefaultConfig: {
      findMany: async () => [
        {
          id: "cfg-proj",
          config: configJson,
          createdAt: new Date("2026-05-15T00:00:00Z"),
          scopes,
        },
      ],
    },
  } as unknown as PrismaClient;
}

describe("resolveModelForFeature — unresolvable latest-alias exhaustion (unit)", () => {
  /** @scenario 'Exhaustion caused by an unresolvable latest-alias still reports "nothing configured"' */
  it("throws plain ModelNotConfiguredError, not a restriction error", async () => {
    const prisma = fakePrisma({ DEFAULT: UNRESOLVABLE_ALIAS });

    await expect(
      resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId: "proj-1",
      }),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });
});
