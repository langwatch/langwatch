/**
 * Which model a feature actually runs on.
 *
 * A default can be set at three scopes and more than once at each, so
 * resolving one is a precedence question: the nearest scope wins, and within a
 * scope the most recently created config does. Both are one line — the tier
 * order and a `createdAt` sort — and both decide, silently, which model a
 * customer's traffic goes to and what it costs.
 *
 * Driven through `getSnapshot` with no actor, which is what makes this cheap:
 * without one the visibility and writability filters short-circuit, so the only
 * collaborators that take part are the scope context, the config store and the
 * feature catalogue.
 */

import { describe, expect, it } from "vitest";
import { ModelProviderDefaultsService } from "../model-provider-defaults.service";

const FEATURES = [
  { key: "prompt.create_default", role: "DEFAULT", displayName: "Prompts", description: "" },
  { key: "langy.chat", role: "LANGY", displayName: "Langy", description: "" },
];

const SCOPES = {
  organization: { id: "organization-1", name: "Acme" },
  teams: [{ id: "team-1", name: "Platform" }],
  projects: [{ id: "project-1", name: "Web", teamId: "team-1" }],
};

type Config = {
  id: string;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt?: Date;
  authorId: string | null;
  scopes: Array<{ scopeType: "PROJECT" | "TEAM" | "ORGANIZATION"; scopeId: string }>;
};

function config(
  id: string,
  scopeType: Config["scopes"][number]["scopeType"],
  scopeId: string,
  values: Record<string, string>,
  createdAt = new Date("2026-01-01T00:00:00.000Z"),
): Config {
  return { id, config: values, createdAt, authorId: null, scopes: [{ scopeType, scopeId }] };
}

function serviceOver(configs: Config[]) {
  return ModelProviderDefaultsService.create({
    scopes: {
      getProjectContext: async () => ({
        teamId: "team-1",
        organizationId: "organization-1",
        organizationName: "Acme",
      }),
      listAvailableScopes: async () => SCOPES,
      getProjectScopes: async () => [],
    },
    defaults: {
      listForOrganization: async () => configs,
      listForProject: async () => configs,
    },
    catalog: {
      defaultFeatures: () => FEATURES,
      // Identity: normalisation is the catalogue's business, not this one's.
      tryNormalizeDefaultModel: ({ model }: { model: string }) => model,
    },
    providers: {},
    authorization: {},
  } as never);
}

async function effectiveFor(configs: Config[]) {
  const snapshot = await serviceOver(configs).getSnapshot({ projectId: "project-1" });
  return snapshot.effective;
}

describe("ModelProviderDefaultsService precedence", () => {
  describe("given the same key set at more than one scope", () => {
    describe("when the default is resolved", () => {
      it("takes the project's over the team's and the organization's", async () => {
        const effective = await effectiveFor([
          config("c1", "ORGANIZATION", "organization-1", { "prompt.create_default": "org-model" }),
          config("c2", "TEAM", "team-1", { "prompt.create_default": "team-model" }),
          config("c3", "PROJECT", "project-1", { "prompt.create_default": "project-model" }),
        ]);

        expect(effective["prompt.create_default"]).toMatchObject({
          model: "project-model",
          scope: "project",
        });
      });

      it("takes the team's over the organization's when the project sets none", async () => {
        const effective = await effectiveFor([
          config("c1", "ORGANIZATION", "organization-1", { "prompt.create_default": "org-model" }),
          config("c2", "TEAM", "team-1", { "prompt.create_default": "team-model" }),
        ]);

        expect(effective["prompt.create_default"]).toMatchObject({
          model: "team-model",
          scope: "team",
        });
      });

      it("falls back to the organization's when neither nearer scope sets one", async () => {
        const effective = await effectiveFor([
          config("c1", "ORGANIZATION", "organization-1", { "prompt.create_default": "org-model" }),
        ]);

        expect(effective["prompt.create_default"]).toMatchObject({
          model: "org-model",
          scope: "organization",
        });
      });
    });
  });

  describe("given the same key set twice at one scope", () => {
    describe("when the default is resolved", () => {
      it("takes the config created most recently", async () => {
        const effective = await effectiveFor([
          config(
            "older",
            "PROJECT",
            "project-1",
            { "prompt.create_default": "old-model" },
            new Date("2026-01-01T00:00:00.000Z"),
          ),
          config(
            "newer",
            "PROJECT",
            "project-1",
            { "prompt.create_default": "new-model" },
            new Date("2026-06-01T00:00:00.000Z"),
          ),
        ]);

        expect(effective["prompt.create_default"]?.model).toBe("new-model");
      });
    });
  });

  describe("given a config belonging to another tenant's scope", () => {
    describe("when the default is resolved", () => {
      it("is not consulted, because the chain only names this project's scopes", async () => {
        const effective = await effectiveFor([
          config("theirs", "PROJECT", "someone-elses-project", {
            "prompt.create_default": "their-model",
          }),
        ]);

        expect(effective["prompt.create_default"]).toBeNull();
      });
    });
  });

  describe("given a value set under a feature key rather than a role", () => {
    describe("when the default is resolved", () => {
      it("records it as a feature override", async () => {
        const effective = await effectiveFor([
          config("c1", "PROJECT", "project-1", { "langy.chat": "chat-model" }),
        ]);

        expect(effective["langy.chat"]).toMatchObject({
          model: "chat-model",
          source: "feature_override",
        });
      });
    });
  });
});
