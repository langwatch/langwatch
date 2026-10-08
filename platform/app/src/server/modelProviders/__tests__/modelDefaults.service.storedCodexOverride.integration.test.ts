/**
 * @vitest-environment node
 *
 * Real-Postgres coverage for the stored-Codex-override carve-out: a config
 * that already stores a Codex model for topic clustering must stay savable
 * when the customer changes a different key, while writing a different
 * Codex value for that key is still refused. The unit tests mock the
 * repository, so this exercises `findConfigById` and the update path
 * against the real table.
 *
 * Spec: specs/topic-clustering/model-resolution.feature
 */

import { ValidationError } from "@langwatch/handled-error";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { prisma } from "../../db";
import { CODEX_DEFAULT_MODEL } from "../codexRestrictions";
import { setRoleAtScope, updateConfig } from "../modelDefaults.service";

wireDefaultTestApp();

const TOPIC_KEY = "analytics.topic_clustering_llm";
const OTHER_CODEX_MODEL = "openai_codex/gpt-5.6-other";

describe("given a config storing a Codex value for topic clustering (real DB)", () => {
  const ns = `mdcfg-codex-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let configId: string;

  const ctx = () => ({ prisma });

  const storedConfig = async () =>
    (
      await prisma.modelDefaultConfig.findUniqueOrThrow({
        where: { id: configId },
        select: { config: true },
      })
    ).config;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Stored Codex Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: `Project ${ns}`,
        slug: `--proj-${ns}`,
        teamId,
        language: "typescript",
        framework: "other",
        apiKey: `test-key-${ns}`,
      },
    });
    projectId = project.id;
  });

  afterEach(() =>
    cleanupTestRows(prisma, [["modelDefaultConfig", { organizationId }]]),
  );

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["modelDefaultConfig", { organizationId }],
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
  });

  // The row is inserted directly: createConfig would refuse the Codex
  // value, and the point is a value saved before the restriction existed.
  const seedStoredCodex = async () => {
    const row = await prisma.modelDefaultConfig.create({
      data: {
        organizationId,
        config: { [TOPIC_KEY]: CODEX_DEFAULT_MODEL },
        scopes: { create: [{ scopeType: "PROJECT", scopeId: projectId }] },
      },
    });
    configId = row.id;
  };

  describe("when a different role is set at the scope", () => {
    /** @scenario "A saved Codex clustering override does not block other default-model changes" */
    it("saves the role and keeps the stored codex value untouched", async () => {
      await seedStoredCodex();

      await setRoleAtScope(ctx(), {
        scopeType: "PROJECT",
        scopeId: projectId,
        role: "FAST",
        model: "openai/gpt-5-mini",
      });

      expect(await storedConfig()).toEqual({
        [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
        FAST: "openai/gpt-5-mini",
      });
    });
  });

  describe("when the drawer saves with scopes and the stored codex value unchanged", () => {
    /** @scenario "A saved Codex clustering override does not block other default-model changes" */
    it("saves the change and keeps the stored codex value untouched", async () => {
      await seedStoredCodex();

      await updateConfig(ctx(), {
        id: configId,
        config: {
          [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
          FAST: "openai/gpt-5-mini",
        },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });

      expect(await storedConfig()).toEqual({
        [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
        FAST: "openai/gpt-5-mini",
      });
    });
  });

  describe("when a different codex value is written for topic clustering", () => {
    /** @scenario "Saving a new Codex model for topic clustering is still rejected" */
    it("rejects with a ValidationError and leaves the row unchanged", async () => {
      await seedStoredCodex();

      await expect(
        updateConfig(ctx(), {
          id: configId,
          config: { [TOPIC_KEY]: OTHER_CODEX_MODEL },
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      expect(await storedConfig()).toEqual({
        [TOPIC_KEY]: CODEX_DEFAULT_MODEL,
      });
    });
  });
});
