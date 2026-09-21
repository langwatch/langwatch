/**
 * @vitest-environment node
 * @integration
 *
 * The two coding-agent recency columns on the project, against the real
 * Postgres row: what a fold records, and how rarely it records it.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { createCodingAgentSessionSeenTouch } from "../../../event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSessionSeen.touch";
import {
  CODING_AGENT_ACTIVITY_TOUCH_MS,
  ProjectService,
} from "../project.service";
import { PrismaProjectRepository } from "../repositories/project.prisma.repository";

const tag = nanoid(8);

let organizationId: string;
let projectId: string;
let archivedProjectId: string;

const projects = new ProjectService(new PrismaProjectRepository(prisma));

async function readActivity(): Promise<{
  lastCodingAgentSessionAt: Date | null;
  lastCodingAgentPullRequestAt: Date | null;
}> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      lastCodingAgentSessionAt: true,
      lastCodingAgentPullRequestAt: true,
    },
  });
  return project;
}

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `ca-activity-${tag}`, slug: `ca-activity-${tag}` },
  });
  organizationId = organization.id;
  const team = await prisma.team.create({
    data: {
      name: `ca-activity-${tag}`,
      slug: `ca-activity-${tag}`,
      organizationId,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: `ca-activity-${tag}`,
      slug: `ca-activity-${tag}`,
      apiKey: `ca-activity-${tag}`,
      teamId: team.id,
      language: "typescript",
      framework: "other",
    },
  });
  projectId = project.id;
  const archivedProject = await prisma.project.create({
    data: {
      name: `ca-activity-archived-${tag}`,
      slug: `ca-activity-archived-${tag}`,
      apiKey: `ca-activity-archived-${tag}`,
      teamId: team.id,
      language: "typescript",
      framework: "other",
      archivedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
  archivedProjectId = archivedProject.id;
});

beforeEach(async () => {
  await prisma.project.update({
    where: { id: projectId },
    data: {
      lastCodingAgentSessionAt: null,
      lastCodingAgentPullRequestAt: null,
    },
  });
});

afterAll(async () => {
  if (organizationId) {
    await cleanupTestRows(prisma, [
      ["project", { team: { organizationId } }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
  }
});

describe("project coding-agent activity", () => {
  describe("given a project that has never recorded a coding-agent session", () => {
    it("records the moment the first session folded", async () => {
      const at = new Date("2026-08-16T10:00:00.000Z");

      await projects.touchCodingAgentSessionSeen({ projectId, at });

      expect((await readActivity()).lastCodingAgentSessionAt).toEqual(at);
    });
  });

  describe("given a session was already recorded within the hour", () => {
    /** @scenario "A busy project is written to at most once an hour" */
    it("leaves the stored moment alone", async () => {
      const first = new Date("2026-08-16T10:00:00.000Z");
      const secondsLater = new Date(first.getTime() + 30_000);

      await projects.touchCodingAgentSessionSeen({ projectId, at: first });
      await projects.touchCodingAgentSessionSeen({
        projectId,
        at: secondsLater,
      });

      expect((await readActivity()).lastCodingAgentSessionAt).toEqual(first);
    });
  });

  describe("given the recorded session is older than the write window", () => {
    it("moves the stored moment forward", async () => {
      const first = new Date("2026-08-16T10:00:00.000Z");
      const wellAfter = new Date(
        first.getTime() + CODING_AGENT_ACTIVITY_TOUCH_MS + 60_000,
      );

      await projects.touchCodingAgentSessionSeen({ projectId, at: first });
      await projects.touchCodingAgentSessionSeen({ projectId, at: wellAfter });

      expect((await readActivity()).lastCodingAgentSessionAt).toEqual(
        wellAfter,
      );
    });
  });

  describe("when a coding-agent session folds", () => {
    /** @scenario "A folded coding-agent session records the project's activity" */
    it("records the activity on the project the session folded under", async () => {
      // The stamp the fold store fires after a commit — the same wiring
      // pipelineRegistry installs on CodingAgentSessionStore.
      const touch = createCodingAgentSessionSeenTouch({
        touchCodingAgentSessionSeen: (params) =>
          projects.touchCodingAgentSessionSeen(params),
      });

      await touch([projectId]);

      const { lastCodingAgentSessionAt, lastCodingAgentPullRequestAt } =
        await readActivity();
      expect(lastCodingAgentSessionAt).not.toBeNull();
      // The fold says a session ran, and nothing more. Reading it as pull
      // request activity too would offer a destination with nothing on it.
      expect(lastCodingAgentPullRequestAt).toBeNull();
    });
  });

  describe("given both columns are written", () => {
    /** @scenario "Each destination is grown by its own signal" */
    it("keeps each column on its own clock", async () => {
      const sessionAt = new Date("2026-08-16T10:00:00.000Z");
      const pullRequestAt = new Date("2026-08-16T11:30:00.000Z");

      await projects.touchCodingAgentSessionSeen({ projectId, at: sessionAt });
      await projects.touchCodingAgentPullRequestSeen({
        projectId,
        at: pullRequestAt,
      });
      // Inside the window for the pull-request column, so it stays put.
      await projects.touchCodingAgentPullRequestSeen({
        projectId,
        at: new Date(pullRequestAt.getTime() + 60_000),
      });

      expect(await readActivity()).toEqual({
        lastCodingAgentSessionAt: sessionAt,
        lastCodingAgentPullRequestAt: pullRequestAt,
      });
    });
  });

  describe("given the project id names nothing", () => {
    // updateMany answers with a count, so a project that was archived away
    // between the fold and the touch is a no-op rather than a thrown error on
    // a path whose failures are all swallowed anyway.
    it("writes nothing and does not throw", async () => {
      await expect(
        projects.touchCodingAgentSessionSeen({
          projectId: `missing-${tag}`,
          at: new Date(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the project was archived", () => {
    it("leaves both columns alone, so no destination comes back", async () => {
      await projects.touchCodingAgentSessionSeen({
        projectId: archivedProjectId,
        at: new Date("2026-08-16T10:00:00.000Z"),
      });
      await projects.touchCodingAgentPullRequestSeen({
        projectId: archivedProjectId,
        at: new Date("2026-08-16T10:00:00.000Z"),
      });

      const archived = await prisma.project.findUniqueOrThrow({
        where: { id: archivedProjectId },
        select: {
          lastCodingAgentSessionAt: true,
          lastCodingAgentPullRequestAt: true,
        },
      });
      expect(archived).toEqual({
        lastCodingAgentSessionAt: null,
        lastCodingAgentPullRequestAt: null,
      });
    });
  });
});
