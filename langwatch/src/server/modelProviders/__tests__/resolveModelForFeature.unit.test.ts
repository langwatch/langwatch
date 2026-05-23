/**
 * Pure-logic unit tests for the resolver. Uses a tiny in-memory fake
 * Prisma stub so the cascade walk + tie-breaking can be exercised
 * without booting a testcontainer. The full storage round-trip lives
 * in the @integration scenarios bound to a real-DB suite that runs in
 * CI's langwatch-app-ci job.
 *
 * Specs bound here:
 *   - specs/model-providers/model-resolver-and-registry.feature
 *     ("Looking up an unknown feature key throws")
 *   - specs/model-providers/model-default-config-cascade.feature
 *     (resolver cascade, tier order, same-tier createdAt DESC,
 *     legacy-column fallback, feature override over role default,
 *     missing-key cascade up)
 */
import { describe, it, expect } from "vitest";

import type {
  ModelDefaultScopeType,
  PrismaClient,
} from "@prisma/client";

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
  defaultModel: string | null;
  topicClusteringModel: string | null;
  embeddingsModel: string | null;
  team: null | {
    id: string;
    organizationId: string | null;
    defaultModel: string | null;
    topicClusteringModel: string | null;
    embeddingsModel: string | null;
    organization: null | {
      id: string;
      defaultModel: string | null;
      topicClusteringModel: string | null;
      embeddingsModel: string | null;
    };
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
              OR: Array<{
                scopeType: ModelDefaultScopeType;
                scopeId: string | { in: string[] };
              }>;
            };
          };
        };
      }) => {
        const filters = where.scopes.some.OR;
        const matches = (s: ScopeRow): boolean =>
          filters.some((f) => {
            if (f.scopeType !== s.scopeType) return false;
            if (typeof f.scopeId === "string") return f.scopeId === s.scopeId;
            return f.scopeId.in.includes(s.scopeId);
          });
        return configs.filter((c) => c.scopes.some(matches));
      },
    },
  } as unknown as PrismaClient;
}

const PROJECT: FakeProjectRow = {
  id: "proj-1",
  teamId: "team-1",
  defaultModel: null,
  topicClusteringModel: null,
  embeddingsModel: null,
  team: {
    id: "team-1",
    organizationId: "org-1",
    defaultModel: null,
    topicClusteringModel: null,
    embeddingsModel: null,
    organization: {
      id: "org-1",
      defaultModel: null,
      topicClusteringModel: null,
      embeddingsModel: null,
    },
  },
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

describe("resolveModelForFeature (unit)", () => {
  /** @scenario Looking up an unknown feature key throws */
  it("throws a clear error for an unknown feature key", async () => {
    const prisma = fakePrisma({ project: PROJECT, configs: [] });
    await expect(
      resolveModelForFeature("not-a-real-key", {
        prisma,
        projectId: PROJECT.id,
      }),
    ).rejects.toThrow(/Unknown feature key/);
  });

  /** @scenario An empty database throws ModelNotConfiguredError */
  it("throws ModelNotConfiguredError when nothing is configured", async () => {
    const prisma = fakePrisma({ project: PROJECT, configs: [] });
    // There is no global system fallback. If no scope in the cascade
    // (and no legacy column) carries the role, AI features for that
    // role are disabled until the user configures a default. The
    // frontend's tRPC interceptor maps this to a sticky toast prompting
    // the user to update their defaults.
    await expect(
      resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId: PROJECT.id,
      }),
    ).rejects.toThrow(/No model configured/i);
  });

  /** @scenario An org-scoped config sets the DEFAULT for every project in that org */
  it("returns an org-scoped DEFAULT for any project in that org", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-org",
          config: { DEFAULT: "openai/gpt-5.5" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        }),
      ],
    });
    const r = await resolveModelForFeature("prompt.create_default", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("openai/gpt-5.5");
    expect(r.source).toBe("role_default");
    expect(r.scope).toBe("organization");
  });

  /** @scenario A project-scoped config wins over an org-scoped one for the same key */
  it("project-scoped config beats org-scoped for the same key", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-org",
          config: { DEFAULT: "openai/gpt-5.5" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        }),
        cfg({
          id: "cfg-proj",
          config: { DEFAULT: "openai/gpt-5.4-mini" },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });
    const r = await resolveModelForFeature("prompt.create_default", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("openai/gpt-5.4-mini");
    expect(r.scope).toBe("project");
  });

  /** @scenario A feature override beats a role default at the same scope */
  it("feature-key override beats role-key default at the same scope", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-proj",
          config: {
            FAST: "openai/gpt-5.4-mini",
            "traces.ai_search": "anthropic/claude-sonnet-4-6",
          },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });
    const r = await resolveModelForFeature("traces.ai_search", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("anthropic/claude-sonnet-4-6");
    expect(r.source).toBe("feature_override");
    expect(r.scope).toBe("project");
  });

  /** @scenario Missing keys cascade up to the next scope tier */
  it("absent keys cascade up to the next scope tier", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-org",
          config: {
            DEFAULT: "openai/gpt-5.5",
            FAST: "openai/gpt-5.4-mini",
          },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        }),
        cfg({
          id: "cfg-proj",
          // Only sets DEFAULT — FAST should cascade up to org.
          config: { DEFAULT: "anthropic/claude-sonnet-4-6" },
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });
    const fast = await resolveModelForFeature("traces.ai_search", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(fast.model).toBe("openai/gpt-5.4-mini");
    expect(fast.scope).toBe("organization");
  });

  /** @scenario Two configs attached to the same project resolve by created-at DESC */
  it("two configs at the same scope: newest createdAt wins", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-old",
          config: { DEFAULT: "openai/gpt-5.4-mini" },
          createdAt: new Date("2026-05-01T00:00:00Z"),
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
        cfg({
          id: "cfg-new",
          config: { DEFAULT: "openai/gpt-5.5" },
          createdAt: new Date("2026-05-15T00:00:00Z"),
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });
    const r = await resolveModelForFeature("prompt.create_default", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("openai/gpt-5.5");
  });

  /** @scenario A lower-tier config beats a newer higher-tier config */
  it("lower tier always beats higher tier regardless of createdAt", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-org-new",
          config: { DEFAULT: "openai/gpt-5.5" },
          createdAt: new Date("2026-05-15T00:00:00Z"),
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        }),
        cfg({
          id: "cfg-proj-old",
          config: { DEFAULT: "openai/gpt-5.4-mini" },
          createdAt: new Date("2026-05-01T00:00:00Z"),
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        }),
      ],
    });
    const r = await resolveModelForFeature("prompt.create_default", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("openai/gpt-5.4-mini");
    expect(r.scope).toBe("project");
  });

  /** @scenario A config can attach to many scopes at once */
  it("a multi-scope config resolves at the most-specific tier in the chain", async () => {
    const prisma = fakePrisma({
      project: PROJECT,
      configs: [
        cfg({
          id: "cfg-shared",
          config: { DEFAULT: "openai/gpt-5.5" },
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: "other-org" },
            { scopeType: "TEAM", scopeId: "team-1" },
            { scopeType: "PROJECT", scopeId: "proj-1" },
          ],
        }),
      ],
    });
    const r = await resolveModelForFeature("prompt.create_default", {
      prisma,
      projectId: PROJECT.id,
    });
    expect(r.model).toBe("openai/gpt-5.5");
    expect(r.scope).toBe("project");
  });
});
