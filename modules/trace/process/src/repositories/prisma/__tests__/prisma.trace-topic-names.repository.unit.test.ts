/**
 * @vitest-environment node
 * Trace reads topic's names through topic's shared Topic table (R40), keeping no copy.
 * Spec: modules/trace/specs/trace-topic-names.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { TraceTopicNamingService } from "../../../services/trace-topic-naming.service.ts";
import { PrismaTraceTopicNamesRepository } from "../prisma.trace-topic-names.repository.ts";

const PROJECT = "project-1";

function repositoryOver(rows: { id: string; name: string }[]) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const repository = PrismaTraceTopicNamesRepository.create({
    prisma: prismaDouble({ topic: { findMany } }),
  });
  return { repository, findMany };
}

describe("given topic's shared Topic table", () => {
  describe("when the trace list asks for the names of a topic and a subtopic", () => {
    /** @scenario "Trace names topic facets from the topics topic holds" */
    it("names both by id, asking only that project's rows", async () => {
      const { repository, findMany } = repositoryOver([
        { id: "t1", name: "Billing" },
        { id: "t2", name: "Refunds" },
      ]);

      const names = await repository.findNamesByIds({ projectId: PROJECT, ids: ["t1", "t2"] });

      expect(names).toEqual(
        new Map([
          ["t1", "Billing"],
          ["t2", "Refunds"],
        ]),
      );
      expect(findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT, id: { in: ["t1", "t2"] } },
        select: { id: true, name: true },
      });
    });
  });

  describe("when the trace list asks for the names of no ids", () => {
    /** @scenario "No topic id asks topic's table nothing" */
    it("answers no names without reading the table", async () => {
      const { repository, findMany } = repositoryOver([]);

      expect(await repository.findNamesByIds({ projectId: PROJECT, ids: [] })).toEqual(new Map());
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the trace list asks for the names of topic ids topic does not hold", () => {
    /** @scenario "An unknown topic id has no label" */
    it("names no id, and the facet keeps the id as its label", async () => {
      const { repository } = repositoryOver([]);
      const naming = TraceTopicNamingService.create({ topicNames: repository });

      const result = await naming.enrichTopicNames(PROJECT, {
        values: [{ value: "t-unknown", count: 2 }],
        totalDistinct: 1,
      } as never);

      expect(result.values).toEqual([{ value: "t-unknown", count: 2 }]);
    });
  });
});
