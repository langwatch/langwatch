/**
 * Topic names for a proof that spans several projects. An aggregate project
 * lists its members' traces, so a topic facet carries topic ids owned by any
 * project in the proof; the lookup reads them all in one query and never
 * names a topic owned by a project outside the list.
 *
 * Spec: specs/governance/aggregate-project.feature, section F.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaTopicRepository } from "../repositories/topic.prisma.repository";

const run = nanoid();
const AGGREGATE = `topic-aggregate-${run}`;
const MEMBER = `topic-member-${run}`;
const OUTSIDER = `topic-outsider-${run}`;
const PROJECTS = [AGGREGATE, MEMBER, OUTSIDER];

const topicId = (projectId: string) => `topic-of-${projectId}`;

const repository = new PrismaTopicRepository(prisma);

beforeAll(async () => {
  await prisma.topic.createMany({
    data: PROJECTS.map((projectId) => ({
      id: topicId(projectId),
      projectId,
      name: `name of ${projectId}`,
      embeddings_model: "test",
      centroid: [],
      p95Distance: 0,
    })),
  });
});

afterAll(async () => {
  await prisma.topic.deleteMany({ where: { projectId: { in: PROJECTS } } });
});

describe("PrismaTopicRepository.findNamesByIds", () => {
  describe("given topics owned by an aggregate, a member and a project outside the list", () => {
    describe("when the names are looked up for the aggregate and the member", () => {
      it("names the aggregate's and the member's topics and not the outsider's", async () => {
        const names = await repository.findNamesByIds({
          projectIds: [AGGREGATE, MEMBER],
          ids: PROJECTS.map(topicId),
        });

        expect([...names.entries()].sort()).toEqual(
          [
            [topicId(AGGREGATE), `name of ${AGGREGATE}`],
            [topicId(MEMBER), `name of ${MEMBER}`],
          ].sort(),
        );
      });
    });

    describe("when no project is named", () => {
      it("names nothing", async () => {
        const names = await repository.findNamesByIds({
          projectIds: [],
          ids: PROJECTS.map(topicId),
        });

        expect(names.size).toBe(0);
      });
    });
  });
});
