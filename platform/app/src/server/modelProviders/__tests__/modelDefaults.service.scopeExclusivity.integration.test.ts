/**
 * @vitest-environment node
 *
 * Real-Postgres coverage for the one-config-per-scope invariant on
 * ModelDefaultConfig writes, and the handled errors the write path
 * raises instead of leaking plain 500s.
 *
 * Customer report (2026-08-13): "+ Add config" at organization scope
 * stacked a second org row instead of replacing the first, and saving
 * an all-inherit new config surfaced a raw "unknown error" 500.
 * Spec: specs/model-providers/model-default-config-cascade.feature
 */

import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import type { Session } from "../../auth";
import { prisma } from "../../db";
import {
  assertCanWriteScope,
  createConfig,
  updateConfig,
} from "../modelDefaults.service";
import { resolveModelForFeature } from "../resolveModelForFeature";

wireDefaultTestApp();

describe("given default-model configs with scope attachments (real DB)", () => {
  const ns = `mdcfg-excl-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let webProjectId: string;
  let apiProjectId: string;
  let memberUserId: string;

  const ctx = () => ({ prisma });

  const attachmentsAt = (
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT",
    scopeId: string,
  ) =>
    prisma.modelDefaultConfigScope.findMany({
      where: { scopeType, scopeId },
      select: { configId: true },
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Scope Exclusivity Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
    });
    teamId = team.id;

    const mkProject = (slug: string) =>
      prisma.project.create({
        data: {
          name: `Project ${slug} ${ns}`,
          slug: `--proj-${slug}-${ns}`,
          teamId,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${slug}-${ns}`,
        },
      });
    webProjectId = (await mkProject("web")).id;
    apiProjectId = (await mkProject("api")).id;

    const member = await prisma.user.create({
      data: {
        name: "Plain Member",
        email: `plain-member-${ns}@example.com`,
      },
    });
    memberUserId = member.id;
    await prisma.organizationUser.create({
      data: {
        userId: member.id,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
  });

  // Each test states the whole world it needs. Without this the tests
  // inherit whatever rows the previous ones left attached, and pass only
  // because claiming happens to clear the leftovers first: adding a test
  // above another would break it.
  //
  // Through cleanupTestRows, not a raw deleteMany: `organizationId` is
  // assigned in beforeAll, so it is still undefined if setup threw before
  // that assignment. A raw deleteMany would then sweep the table, because
  // Prisma drops an undefined filter rather than matching nothing (#6219).
  // cleanupTestRows refuses an entry that identifies nothing, so the rows
  // are left untouched and the teardown throws instead. The scope rows
  // cascade on the config foreign key.
  afterEach(() =>
    cleanupTestRows(prisma, [["modelDefaultConfig", { organizationId }]]),
  );

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["modelDefaultConfig", { organizationId }],
      ["organizationUser", { organizationId }],
      ["project", { id: { in: [webProjectId, apiProjectId] } }],
      ["team", { id: teamId }],
      ["user", { id: memberUserId }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("when a new config is created at a scope that already has one", () => {
    /** @scenario Creating a config at a scope that already has one replaces that scope's config */
    it("claims the scope and deletes the emptied previous config", async () => {
      const old = await createConfig(ctx(), {
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        authorId: null,
      });
      const replacement = await createConfig(ctx(), {
        config: { DEFAULT: "gemini/gemini-2.5-pro" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        authorId: null,
      });

      const attached = await attachmentsAt("ORGANIZATION", organizationId);
      expect(attached).toEqual([{ configId: replacement.id }]);

      const oldRow = await prisma.modelDefaultConfig.findUnique({
        where: { id: old.id },
      });
      expect(oldRow).toBeNull();

      // The part a customer actually sees. Asserting only the rows would
      // stay green if the claim detached the attachment but the resolver
      // still read the config that lost it.
      const resolved = await resolveModelForFeature("prompt.create_default", {
        prisma,
        projectId: webProjectId,
      });
      expect(resolved.model).toBe("gemini/gemini-2.5-pro");
    });
  });

  describe("when the previous holder is attached to other scopes too", () => {
    /** @scenario Claiming a scope held by a multi-scope config detaches only that scope */
    it("keeps the multi-scope config alive with its remaining scopes", async () => {
      const multi = await createConfig(ctx(), {
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [
          { scopeType: "PROJECT", scopeId: webProjectId },
          { scopeType: "PROJECT", scopeId: apiProjectId },
        ],
        authorId: null,
      });
      const claimer = await createConfig(ctx(), {
        config: { DEFAULT: "gemini/gemini-2.5-pro" },
        scopes: [{ scopeType: "PROJECT", scopeId: webProjectId }],
        authorId: null,
      });

      const webAttached = await attachmentsAt("PROJECT", webProjectId);
      expect(webAttached).toEqual([{ configId: claimer.id }]);

      const survivor = await prisma.modelDefaultConfig.findUnique({
        where: { id: multi.id },
        select: { config: true, scopes: { select: { scopeId: true } } },
      });
      expect(survivor?.config).toEqual({ DEFAULT: "openai/gpt-5.5" });
      expect(survivor?.scopes).toEqual([{ scopeId: apiProjectId }]);
    });
  });

  describe("when an update attaches a scope another config holds", () => {
    /** @scenario Adding a scope to an existing config claims it from its previous config */
    it("claims the scope for the updated config and deletes the emptied holder", async () => {
      const projectConfig = await createConfig(ctx(), {
        config: { DEFAULT: "openai/gpt-5.4-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: apiProjectId }],
        authorId: null,
      });
      const orgConfig = await createConfig(ctx(), {
        config: { DEFAULT: "openai/gpt-5.5" },
        scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
        authorId: null,
      });

      await updateConfig(ctx(), {
        id: orgConfig.id,
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: organizationId },
          { scopeType: "PROJECT", scopeId: apiProjectId },
        ],
      });

      const apiAttached = await attachmentsAt("PROJECT", apiProjectId);
      expect(apiAttached).toEqual([{ configId: orgConfig.id }]);

      const projectRow = await prisma.modelDefaultConfig.findUnique({
        where: { id: projectConfig.id },
      });
      expect(projectRow).toBeNull();
    });
  });

  describe("when a brand-new config carries no keys at all", () => {
    /** @scenario Saving a brand-new config with every key on Inherit is refused with a handled error */
    it("refuses with a handled validation_error instead of a plain 500", async () => {
      await expect(
        createConfig(ctx(), {
          config: {},
          scopes: [{ scopeType: "TEAM", scopeId: teamId }],
          authorId: null,
        }),
      ).rejects.toMatchObject({
        isHandled: true,
        code: "validation_error",
      });

      const attached = await attachmentsAt("TEAM", teamId);
      expect(attached).toEqual([]);
    });
  });

  describe("when an existing config is edited down to no keys", () => {
    /** @scenario Editing an existing config to all-Inherit deletes it */
    it("deletes the config and its scope attachments", async () => {
      const config = await createConfig(ctx(), {
        config: { FAST: "openai/gpt-5.4-mini" },
        scopes: [{ scopeType: "TEAM", scopeId: teamId }],
        authorId: null,
      });

      await updateConfig(ctx(), { id: config.id, config: {} });

      const row = await prisma.modelDefaultConfig.findUnique({
        where: { id: config.id },
      });
      expect(row).toBeNull();
      const attached = await attachmentsAt("TEAM", teamId);
      expect(attached).toEqual([]);
    });
  });

  describe("when the caller cannot manage the target scope", () => {
    /** @scenario Saving into a scope the caller cannot manage is refused with a handled error */
    it("raises model_default_scope_forbidden with a 403 and writes nothing", async () => {
      const session = { user: { id: memberUserId } } as Session;
      // The guard runs before the write, the way every save path
      // (tRPC drawer save, REST create/update/delete) orders them. A
      // refactor that dropped the guard would create the row here.
      const save = async () => {
        await assertCanWriteScope(
          { prisma, session },
          "ORGANIZATION",
          organizationId,
        );
        await createConfig(ctx(), {
          config: { DEFAULT: "openai/gpt-5.5" },
          scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          authorId: null,
        });
      };

      await expect(save()).rejects.toMatchObject({
        isHandled: true,
        code: "model_default_scope_forbidden",
        httpStatus: 403,
      });

      expect(await attachmentsAt("ORGANIZATION", organizationId)).toEqual([]);
      expect(
        await prisma.modelDefaultConfig.count({ where: { organizationId } }),
      ).toBe(0);
    });
  });
});
