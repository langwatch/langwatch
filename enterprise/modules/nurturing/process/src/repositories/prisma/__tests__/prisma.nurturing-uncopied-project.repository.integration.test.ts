// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own record of when it first saw a project with no placement copy.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
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

import { PrismaNurturingUncopiedProjectRepository } from "../prisma.nurturing-uncopied-project.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const projectId = `test-nurturing-uncopied-${randomUUID()}`;
const FIRST_SEEN = Date.UTC(2026, 10, 11, 12);

describe.skipIf(!databaseUrl)("given nurturing's uncopied projects", () => {
  let connection: PrismaConnection;
  let uncopiedProjects: PrismaNurturingUncopiedProjectRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:uncopied"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    uncopiedProjects = PrismaNurturingUncopiedProjectRepository.create({
      prisma: connection.client,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingUncopiedProject.deleteMany({ where: { projectId } });
    await connection.closeOnce();
  });

  /** @scenario "The retry window is real time from first seen, shared by every worker and kept across a restart" */
  it("keeps the first time a project was seen, however often or concurrently it is asked", async () => {
    const answers = await Promise.all([
      uncopiedProjects.firstSeenAt({ projectId, seenAt: FIRST_SEEN }),
      uncopiedProjects.firstSeenAt({ projectId, seenAt: FIRST_SEEN }),
    ]);
    const later = await uncopiedProjects.firstSeenAt({ projectId, seenAt: FIRST_SEEN + 60_000 });

    expect(answers).toEqual([FIRST_SEEN, FIRST_SEEN]);
    expect(later).toBe(FIRST_SEEN);
  });

  /** @scenario "A project with no copy after the retries is dropped, and its later batches at once" */
  it("forgets a project, so it is next seen afresh", async () => {
    await uncopiedProjects.firstSeenAt({ projectId, seenAt: FIRST_SEEN });

    await uncopiedProjects.forget({ projectId });

    await expect(
      uncopiedProjects.firstSeenAt({ projectId, seenAt: FIRST_SEEN + 60_000 }),
    ).resolves.toBe(FIRST_SEEN + 60_000);
  });
});
