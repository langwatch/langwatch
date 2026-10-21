// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The conditional updateMany guards for coding signals: Postgres re-checks each WHERE under the
 * row lock, so two writers at once change the row once.
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
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

import { PrismaNurturingMilestonesRepository } from "../prisma.nurturing-milestones.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const base = `test-nurturing-coding-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given nurturing's organizations table and coding signals", () => {
  let connection: PrismaConnection;
  let repository: PrismaNurturingMilestonesRepository;
  const created: string[] = [];

  async function learned(name: string): Promise<string> {
    const organizationId = `${base}-${name}`;
    created.push(organizationId);
    await repository.recordOrganization({ organizationId, adminUserId: "admin-1", seeded: false });
    return organizationId;
  }

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:coding"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaNurturingMilestonesRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingOrganization.deleteMany({
      where: { organizationId: { in: created } },
    });
    await connection.closeOnce();
  });

  describe("when two first sessions are recorded at once", () => {
    /** @scenario "Concurrent first-session writes change the row once" */
    it("reports first for exactly one of them", async () => {
      const organizationId = await learned("first");

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          repository.recordCodingFirstSession({ organizationId, occurredAt: 1_000 + i }),
        ),
      );

      expect(results.filter(({ first }) => first)).toHaveLength(1);
    });
  });

  describe("when the same agent type is added at once", () => {
    it("holds it once", async () => {
      const organizationId = await learned("types");

      await Promise.all(
        Array.from({ length: 5 }, () =>
          repository.addCodingAgentType({ organizationId, agentType: "claude_code" }),
        ),
      );

      expect((await repository.findOrganization({ organizationId }))[0]?.codingAgentTypes).toEqual([
        "claude_code",
      ]);
    });
  });

  describe("when the same day is recorded at once", () => {
    it("counts it once", async () => {
      const organizationId = await learned("days");

      await Promise.all(
        Array.from({ length: 5 }, () =>
          repository.recordCodingActiveDay({ organizationId, day: "2026-10-20" }),
        ),
      );

      expect((await repository.findOrganization({ organizationId }))[0]?.codingActiveDays).toBe(1);
    });
  });

  describe("when a late earlier day arrives after a later one", () => {
    /** @scenario "A late session of an earlier day changes nothing" */
    it("reports no change", async () => {
      const organizationId = await learned("late");
      await repository.recordCodingActiveDay({ organizationId, day: "2026-10-23" });

      await expect(
        repository.recordCodingActiveDay({ organizationId, day: "2026-10-22" }),
      ).resolves.toEqual({ changed: false, codingActiveDays: 1 });
    });
  });

  describe("when the organization is not learned", () => {
    it("changes nothing for any of the three writes", async () => {
      const organizationId = `${base}-absent`;

      await expect(
        Promise.all([
          repository.recordCodingFirstSession({ organizationId, occurredAt: 1 }),
          repository.addCodingAgentType({ organizationId, agentType: "codex" }),
          repository.recordCodingActiveDay({ organizationId, day: "2026-10-20" }),
        ]),
      ).resolves.toEqual([
        { first: false },
        { changed: false, codingAgentTypes: [] },
        { changed: false, codingActiveDays: 0 },
      ]);
    });
  });
});
