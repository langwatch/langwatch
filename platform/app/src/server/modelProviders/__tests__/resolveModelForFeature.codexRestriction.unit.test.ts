/**
 * Pure-logic unit tests for the resolver's handling of a restricted
 * (codex) model found while walking the cascade (issue #6634, Gap 1).
 *
 * Today no product write path can save a codex value on a DEFAULT-role key
 * (setRoleAtScope / setFeatureAtScope both refuse it — see
 * codexRestrictions.unit.test.ts), so this state is reachable only via a
 * raw DB write or a value legal when saved becoming restricted later. The
 * resolver still needs to tell the two exhaustion causes apart: a
 * restricted value it had to skip vs. genuinely nothing configured. See
 * specs/model-providers/model-default-config-cascade.feature
 * ("Refusal-caused exhaustion").
 *
 * Same fake-Prisma-stub approach as resolveModelForFeature.unit.test.ts —
 * kept in this file rather than shared so each file stays a self-contained
 * read of its own scenarios.
 */

import type { ModelDefaultScopeType, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { CODEX_DEFAULT_MODEL } from "../codexRestrictions";
import { ModelNotConfiguredError } from "../modelNotConfiguredError";
import { ModelRestrictedForFeatureError } from "../modelRestrictedForFeatureError";
import { resolveModelForFeature } from "../resolveModelForFeature";

interface ScopeRow {
  scopeType: ModelDefaultScopeType;
  scopeId: string;
}

interface FakeConfigRow {
  id: string;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  scopes: ScopeRow[];
}

interface FakeProjectRow {
  id: string;
  teamId: string | null;
  team: null | {
    id: string;
    organizationId: string | null;
  };
}

function fakePrisma({
  project,
  configs,
}: {
  project: FakeProjectRow;
  configs: FakeConfigRow[];
}): PrismaClient {
  return {
    project: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === project.id ? project : null,
    },
    modelDefaultConfig: {
      findMany: async ({
        where,
      }: {
        where: {
          scopes: {
            some: {
              OR: Array<{ scopeType: ModelDefaultScopeType; scopeId: string }>;
            };
          };
        };
      }) => {
        const filters = where.scopes.some.OR;
        const matches = (s: ScopeRow): boolean =>
          filters.some(
            (f) => f.scopeType === s.scopeType && f.scopeId === s.scopeId,
          );
        return configs.filter((c) => c.scopes.some(matches));
      },
    },
  } as unknown as PrismaClient;
}

const PROJECT: FakeProjectRow = {
  id: "proj-1",
  teamId: "team-1",
  team: { id: "team-1", organizationId: "org-1" },
};

function cfg(overrides: Partial<FakeConfigRow>): FakeConfigRow {
  return {
    id: overrides.id ?? "cfg",
    config: overrides.config ?? {},
    createdAt: overrides.createdAt ?? new Date("2026-05-15T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-05-15T00:00:00Z"),
    scopes: overrides.scopes ?? [],
  };
}

describe("resolveModelForFeature — restricted-model exhaustion (unit)", () => {
  /** @scenario 'Exhaustion caused entirely by a restricted model reports the refusal, not "nothing configured"' */
  it("throws ModelRestrictedForFeatureError, not ModelNotConfiguredError, when only a restricted value exists", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-proj",
          config: { DEFAULT: CODEX_DEFAULT_MODEL },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });

    await expect(
      resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId: PROJECT.id,
      }),
    ).rejects.toBeInstanceOf(ModelRestrictedForFeatureError);
  });

  it("does not throw ModelNotConfiguredError for the restricted-only case", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-proj",
          config: { DEFAULT: CODEX_DEFAULT_MODEL },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });

    let caught: unknown;
    try {
      await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId: PROJECT.id,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(ModelNotConfiguredError);
  });

  it("carries the code and names the restricted model in meta", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-proj",
          config: { DEFAULT: CODEX_DEFAULT_MODEL },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });

    try {
      await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId: PROJECT.id,
      });
      expect.fail("expected resolveModelForFeature to throw");
    } catch (err) {
      const restricted = err as ModelRestrictedForFeatureError;
      expect(restricted.code).toBe("model_restricted_for_feature");
      expect(restricted.meta.restrictedModels).toContain(CODEX_DEFAULT_MODEL);
    }
  });

  /** @scenario "A restricted DEFAULT-role value at project tier is skipped in favor of a wider tier" */
  it("skips a restricted value at a lower tier and resolves a usable one further up", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-proj",
          config: { DEFAULT: CODEX_DEFAULT_MODEL },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
        cfg({
          id: "cfg-org",
          config: { DEFAULT: "openai/gpt-5-mini" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        }),
      ],
    });

    const r = await resolveModelForFeature("prompt.create_default", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("openai/gpt-5-mini");
    expect(r.source).toBe("role_default");
    expect(r.scope).toBe("organization");
  });
});
