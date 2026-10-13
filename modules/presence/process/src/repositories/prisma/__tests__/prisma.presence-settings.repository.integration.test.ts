/**
 * @vitest-environment node
 * Presence reads its settings from project's and organization's rows through their shares (R40).
 * Spec: modules/presence/specs/presence.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPresenceSettingsRepository } from "../prisma.presence-settings.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-presence-settings-${randomUUID()}`;
const organizationId = `${namespace}-organization`;
const teamId = `${namespace}-team`;
const projectId = `${namespace}-project`;

describe.skipIf(!databaseUrl)("given project's and organization's tables", () => {
  let connection: PrismaConnection;
  let repository: PrismaPresenceSettingsRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:presence:test:settings"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaPresenceSettingsRepository.create({ prisma });
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace, presenceEnabled: true },
    });
    await prisma.team.create({
      data: { id: teamId, organizationId, name: namespace, slug: namespace },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        teamId,
        name: projectId,
        slug: projectId,
        apiKey: projectId,
        language: "typescript",
        framework: "test",
        presenceEnabled: false,
      },
    });
  });

  afterAll(async () => {
    if (!connection) return;
    const prisma = connection.client;
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when presence reads a stored project's settings", () => {
    /** @scenario "Presence reads the settings from project's and organization's rows" */
    it("holds the project's setting as off and the organization's as on", async () => {
      await expect(repository.getSettings({ projectId })).resolves.toEqual({
        outcome: "known",
        projectEnabled: false,
        organizationEnabled: true,
      });
    });
  });

  describe("when presence reads a project id its owner does not hold", () => {
    /** @scenario "A project id its owner does not hold reads as unknown" */
    it("answers unknown", async () => {
      await expect(repository.getSettings({ projectId: `${namespace}-absent` })).resolves.toEqual({
        outcome: "unknown",
      });
    });
  });
});
