/**
 * Which model a feature actually runs on.
 *
 * Two things are being decided here. The first is precedence — a project's
 * choice beats a team's beats the organization's, a feature-specific override
 * beats the role default, and the newest configuration wins a tie — and
 * getting it wrong sends a customer's traffic to a model they did not pick.
 *
 * The second is a licensing rule rather than a preference. A Codex model bills
 * the user's ChatGPT plan through a backend licensed for coding harnesses and
 * light assists, so it may run Langy and the FAST assists and nothing else.
 * The resolver has to step over one configured anywhere else — and say WHY,
 * because "this model is not allowed here" and "you have not configured one"
 * send the customer to different places.
 */

import { describe, expect, it } from "vitest";
import {
  ModelNotConfiguredError,
  ModelProviderInvalidError,
  ModelRestrictedForFeatureError,
} from "@langwatch/model-provider-contract";
import { ModelProviderResolutionService } from "../model-provider-resolution.service";

const PLAYGROUND = "prompt.create_default";
const LANGY = "langy.chat";
const CODEX_MODEL = "openai_codex/gpt-5.6-terra";

const feature = (key: string, role: string) => ({
  key,
  role,
  displayName: key,
  description: `the ${key} feature`,
});

function config(over: {
  scopeType: "PROJECT" | "TEAM" | "ORGANIZATION";
  scopeId: string;
  config: Record<string, string>;
  createdAt?: Date;
  id?: string;
}) {
  return {
    id: over.id ?? `config-${over.scopeType}-${over.scopeId}`,
    config: over.config,
    scopes: [{ scopeType: over.scopeType, scopeId: over.scopeId }],
    authorId: null,
    createdAt: over.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
  };
}

function resolverWith(options: {
  configs: ReturnType<typeof config>[];
  teamId?: string | null;
  organizationId?: string | null;
}) {
  return ModelProviderResolutionService.create({
    defaults: {
      listForOrganization: async () => options.configs,
      listForProject: async () => options.configs,
    },
    catalog: {
      defaultFeatures: () => [
        feature(LANGY, "LANGY"),
        feature(PLAYGROUND, "DEFAULT"),
        feature("scenarios.judge", "DEFAULT"),
      ],
    },
    scopes: {
      getProjectContext: async () => ({
        teamId: options.teamId === undefined ? "team-1" : options.teamId,
        organizationId:
          options.organizationId === undefined ? "organization-1" : options.organizationId,
      }),
      getProjectScopes: async () => [],
    },
  } as never);
}

const resolve = (resolver: ModelProviderResolutionService, featureKey = PLAYGROUND) =>
  resolver.resolve({ projectId: "project-1", featureKey });

describe("ModelProviderResolutionService.resolve", () => {
  describe("given the same feature configured at every tier", () => {
    it("takes the project's choice", async () => {
      const resolver = resolverWith({
        configs: [
          config({
            scopeType: "ORGANIZATION",
            scopeId: "organization-1",
            config: { [PLAYGROUND]: "org-model" },
          }),
          config({ scopeType: "TEAM", scopeId: "team-1", config: { [PLAYGROUND]: "team-model" } }),
          config({
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: "project-model" },
          }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({
        model: "project-model",
        scope: "project",
      });
    });

    it("falls to the team when the project has none", async () => {
      const resolver = resolverWith({
        configs: [
          config({
            scopeType: "ORGANIZATION",
            scopeId: "organization-1",
            config: { [PLAYGROUND]: "org-model" },
          }),
          config({ scopeType: "TEAM", scopeId: "team-1", config: { [PLAYGROUND]: "team-model" } }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({
        model: "team-model",
        scope: "team",
      });
    });

    it("falls to the organization when neither has one", async () => {
      const resolver = resolverWith({
        configs: [
          config({
            scopeType: "ORGANIZATION",
            scopeId: "organization-1",
            config: { [PLAYGROUND]: "org-model" },
          }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({
        model: "org-model",
        scope: "organization",
      });
    });
  });

  describe("given a feature override and a role default at the same tier", () => {
    it("takes the feature's own, and says which it was", async () => {
      const resolver = resolverWith({
        configs: [
          config({
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: "specific-model", DEFAULT: "role-model" },
          }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({
        model: "specific-model",
        source: "feature_override",
      });
    });

    it("takes the role default when the feature has none", async () => {
      const resolver = resolverWith({
        configs: [
          config({ scopeType: "PROJECT", scopeId: "project-1", config: { DEFAULT: "role-model" } }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({
        model: "role-model",
        source: "role_default",
      });
    });
  });

  describe("given two configurations at the same tier", () => {
    it("takes the newer one", async () => {
      const resolver = resolverWith({
        configs: [
          config({
            id: "older",
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: "older-model" },
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
          config({
            id: "newer",
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: "newer-model" },
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
          }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({ model: "newer-model" });
    });
  });

  describe("given a configuration belonging to another project", () => {
    it("does not consult it", async () => {
      const resolver = resolverWith({
        configs: [
          config({
            scopeType: "PROJECT",
            scopeId: "project-other",
            config: { [PLAYGROUND]: "other-model" },
          }),
        ],
      });

      await expect(resolve(resolver)).rejects.toBeInstanceOf(ModelNotConfiguredError);
    });
  });

  describe("given a Codex model configured for a feature its licence does not cover", () => {
    const restricted = () =>
      resolverWith({
        configs: [
          config({
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: CODEX_MODEL },
          }),
        ],
      });

    it("refuses to run it", async () => {
      await expect(resolve(restricted())).rejects.toBeInstanceOf(ModelRestrictedForFeatureError);
    });

    it("says the model is restricted, not that nothing is configured", async () => {
      // The two send a customer to different places: one to change the model,
      // the other to set one at all.
      await expect(resolve(restricted())).rejects.not.toBeInstanceOf(ModelNotConfiguredError);
    });

    it("names the model that was refused", async () => {
      await expect(resolve(restricted())).rejects.toMatchObject({
        meta: expect.objectContaining({ restrictedModels: [CODEX_MODEL] }),
      });
    });
  });

  describe("given the same Codex model on a feature its licence does cover", () => {
    it("runs it", async () => {
      const resolver = resolverWith({
        configs: [
          config({ scopeType: "PROJECT", scopeId: "project-1", config: { [LANGY]: CODEX_MODEL } }),
        ],
      });

      await expect(resolve(resolver, LANGY)).resolves.toMatchObject({ model: CODEX_MODEL });
    });
  });

  describe("given Langy has no model of its own", () => {
    it("borrows the one the playground uses", async () => {
      // Langy is the one feature with a second chance: rather than refusing a
      // conversation, it falls back to the general default.
      const resolver = resolverWith({
        configs: [
          config({
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: "fallback-model" },
          }),
        ],
      });

      await expect(resolve(resolver, LANGY)).resolves.toMatchObject({ model: "fallback-model" });
    });

    it("still refuses when neither has one", async () => {
      const resolver = resolverWith({ configs: [] });

      await expect(resolve(resolver, LANGY)).rejects.toBeInstanceOf(ModelNotConfiguredError);
    });
  });

  describe("given a feature key the catalogue does not know", () => {
    it("refuses it as invalid rather than as unconfigured", async () => {
      const resolver = resolverWith({ configs: [] });

      await expect(resolve(resolver, "not.a.feature")).rejects.toBeInstanceOf(
        ModelProviderInvalidError,
      );
    });
  });

  describe("given a project with no organization", () => {
    it("reads the defaults scoped to the project instead", async () => {
      const resolver = resolverWith({
        organizationId: null,
        teamId: null,
        configs: [
          config({
            scopeType: "PROJECT",
            scopeId: "project-1",
            config: { [PLAYGROUND]: "project-model" },
          }),
        ],
      });

      await expect(resolve(resolver)).resolves.toMatchObject({ model: "project-model" });
    });
  });
});
