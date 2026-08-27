/**
 * @vitest-environment node
 *
 * The REST evaluator create resolves default models per role (#7556). It used
 * to ask the cascade for BOTH the chat default and the embeddings default on
 * every create, so an organization whose default config carried DEFAULT and
 * FAST but no EMBEDDINGS could not create a `ragas/faithfulness` evaluator,
 * whose settings schema has no `embeddings_model` field at all.
 *
 * The org shape here is the production one: an Anthropic-first organization
 * that seeded DEFAULT and FAST and never got an EMBEDDINGS key.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { expandLatestAlias } from "@langwatch/model-provider-contract";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { app } from "../[[...route]]/app";

wireDefaultTestApp();

describe("given an organization whose default models carry DEFAULT and FAST but no EMBEDDINGS", () => {
  const ns = nanoid(8);

  let organization: Organization;
  let team: Team;
  let project: Project;

  const post = (body: unknown) =>
    app.request("/api/evaluators", {
      method: "POST",
      headers: {
        "X-Auth-Token": project.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: `Eval Models Org ${ns}`, slug: `--test-eval-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: `Team ${ns}`,
        slug: `--team-eval-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `--proj-eval-${ns}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    await prisma.modelDefaultConfig.create({
      data: {
        id: `mdc_${nanoid()}`,
        organizationId: organization.id,
        config: {
          DEFAULT: "anthropic/latest",
          FAST: "anthropic/latest-mini",
        },
        scopes: {
          create: [
            {
              id: `mdcs_${nanoid()}`,
              scopeType: "ORGANIZATION",
              scopeId: organization.id,
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["evaluator", { projectId: project.id }],
      ["modelDefaultConfig", { organizationId: organization.id }],
      ["project", { id: project.id }],
      ["team", { id: team.id }],
      ["organization", { id: organization.id }],
    ]);
  });

  describe("when creating an evaluator whose settings carry no embeddings_model", () => {
    /** @scenario A faithfulness evaluator is created with no embeddings default configured */
    it("creates it and fills the chat model from the organization's default", async () => {
      const response = await post({
        name: `Faithfulness ${ns}`,
        config: { evaluatorType: "ragas/faithfulness" },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        config: { settings: Record<string, unknown> };
      };
      // The stored config holds the `anthropic/latest` alias; the resolver
      // expands it to the catalog's current flagship on the way out, so the
      // expectation is the expansion rather than a pinned model id that a
      // catalog release would break.
      expect(body.config.settings.model).toBe(expandLatestAlias("anthropic/latest"));
      expect(body.config.settings).not.toHaveProperty("embeddings_model");
    });
  });

  describe("when creating an evaluator whose settings do carry embeddings_model", () => {
    /** @scenario A type that does need embeddings still refuses when none is configured */
    it("refuses with model_not_configured", async () => {
      const response = await post({
        name: `Response relevancy ${ns}`,
        config: { evaluatorType: "ragas/response_relevancy" },
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; role: string };
      expect(body.error).toBe("model_not_configured");
      expect(body.role).toBe("EMBEDDINGS");
    });
  });
});
