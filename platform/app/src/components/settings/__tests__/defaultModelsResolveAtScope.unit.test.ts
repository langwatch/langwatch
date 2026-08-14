/**
 * @vitest-environment node
 *
 * The table cells walk the cascade client-side to display each row's
 * resolved models. The walk must follow the row's OWN scope chain
 * (project, then its own team, then the organization). It used to match
 * parent tiers by type alone, so a project row displayed values from
 * any team in the organization, values the runtime resolver would
 * never serve for that project.
 *
 * Binds "Config cells resolve inherited values only from the row's own
 * scope chain" in specs/model-providers/role-based-default-models.feature.
 */
import { describe, expect, it } from "vitest";

import { resolveAtScope } from "../DefaultModelsSection";

type ConfigRow = Parameters<typeof resolveAtScope>[0]["configs"][number];

const HIERARCHY = {
  organization: { id: "org-1" },
  teams: [{ id: "team-platform" }, { id: "team-research" }],
  projects: [
    { id: "proj-web", teamId: "team-platform" },
    { id: "proj-lab", teamId: "team-research" },
    // A project the viewer can see without seeing its team. The chain
    // must skip the team tier rather than fall back to matching any
    // team by type.
    { id: "proj-orphan", teamId: null },
  ],
};

function configRow(params: {
  id: string;
  config: Record<string, string>;
  scopes: Array<{
    type: "ORGANIZATION" | "TEAM" | "PROJECT";
    id: string;
  }>;
  createdAt?: string;
}): ConfigRow {
  return {
    id: params.id,
    config: params.config,
    createdAt: new Date(params.createdAt ?? "2026-05-01T00:00:00Z"),
    updatedAt: new Date(params.createdAt ?? "2026-05-01T00:00:00Z"),
    authorId: null,
    scopes: params.scopes.map((s) => ({ ...s, name: s.id })),
  } as ConfigRow;
}

const ORG_CONFIG = configRow({
  id: "cfg-org",
  config: { FAST: "openai/gpt-5-mini" },
  scopes: [{ type: "ORGANIZATION", id: "org-1" }],
});

const RESEARCH_TEAM_CONFIG = configRow({
  id: "cfg-research",
  config: { FAST: "anthropic/claude-haiku" },
  scopes: [{ type: "TEAM", id: "team-research" }],
  createdAt: "2026-06-01T00:00:00Z",
});

const WEB_PROJECT_CONFIG = configRow({
  id: "cfg-web",
  config: {},
  scopes: [{ type: "PROJECT", id: "proj-web" }],
});

const ALL = [ORG_CONFIG, RESEARCH_TEAM_CONFIG, WEB_PROJECT_CONFIG];

describe("resolveAtScope", () => {
  describe("when a project row resolves a key it does not pin", () => {
    /** @scenario Config cells resolve inherited values only from the row's own scope chain */
    it("consults the project's own team and organization, never a sibling team", () => {
      const resolved = resolveAtScope({
        key: "FAST",
        configs: ALL,
        anchor: { type: "PROJECT", id: "proj-web" },
        hierarchy: HIERARCHY,
      });

      // proj-web belongs to team-platform, which has no config, so the
      // walk lands on the organization. team-research's newer config
      // must not shadow it.
      expect(resolved?.model).toBe("openai/gpt-5-mini");
      expect(resolved?.scope).toBe("organization");
    });

    it("resolves through the row's own team when that team has the key", () => {
      const resolved = resolveAtScope({
        key: "FAST",
        configs: ALL,
        anchor: { type: "PROJECT", id: "proj-lab" },
        hierarchy: HIERARCHY,
      });

      expect(resolved?.model).toBe("anthropic/claude-haiku");
      expect(resolved?.scope).toBe("team");
    });

    it("skips the team tier when the project is not in the hierarchy", () => {
      const resolved = resolveAtScope({
        key: "FAST",
        configs: ALL,
        anchor: { type: "PROJECT", id: "proj-unknown" },
        hierarchy: HIERARCHY,
      });

      expect(resolved?.model).toBe("openai/gpt-5-mini");
      expect(resolved?.scope).toBe("organization");
    });

    it("skips the team tier for a known project that carries no team", () => {
      const resolved = resolveAtScope({
        key: "FAST",
        configs: ALL,
        anchor: { type: "PROJECT", id: "proj-orphan" },
        hierarchy: HIERARCHY,
      });

      // team-research's newer config must not be borrowed just because
      // this project's own team is unknown.
      expect(resolved?.model).toBe("openai/gpt-5-mini");
      expect(resolved?.scope).toBe("organization");
    });
  });

  describe("when the hierarchy carries no organization", () => {
    it("stops at the tiers it can resolve instead of guessing one", () => {
      const resolved = resolveAtScope({
        key: "FAST",
        configs: ALL,
        anchor: { type: "PROJECT", id: "proj-web" },
        hierarchy: { ...HIERARCHY, organization: null },
      });

      expect(resolved).toBeNull();
    });
  });

  describe("when a team row resolves a key", () => {
    it("walks team then organization, ignoring other teams", () => {
      const resolved = resolveAtScope({
        key: "FAST",
        configs: ALL,
        anchor: { type: "TEAM", id: "team-platform" },
        hierarchy: HIERARCHY,
      });

      expect(resolved?.model).toBe("openai/gpt-5-mini");
      expect(resolved?.scope).toBe("organization");
    });
  });

  describe("when nothing in the chain carries the key", () => {
    it("returns null", () => {
      const resolved = resolveAtScope({
        key: "EMBEDDINGS",
        configs: ALL,
        anchor: { type: "PROJECT", id: "proj-web" },
        hierarchy: HIERARCHY,
      });

      expect(resolved).toBeNull();
    });
  });
});
