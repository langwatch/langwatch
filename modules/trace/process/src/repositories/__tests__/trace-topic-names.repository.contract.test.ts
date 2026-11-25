/**
 * @vitest-environment node
 * Trace's topic-name reader answers alike over its memory twin and over the Prisma reader
 * (run here on a Topic delegate that honours the where clause the reader sends).
 * Spec: modules/trace/specs/trace-topic-names.feature
 */
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import type { TraceTopicNamesReadRepository } from "../../features/topic/repositories/trace-topic-names.repository.ts";
import { MemoryTraceTopicNamesRepository } from "../memory/memory.trace-topic-names.repository.ts";
import { PrismaTraceTopicNamesRepository } from "../prisma/prisma.trace-topic-names.repository.ts";

type SeededTopic = { projectId: string; id: string; name: string };

const TOPICS: readonly SeededTopic[] = [
  { projectId: "project-1", id: "t1", name: "Billing" },
  { projectId: "project-1", id: "t2", name: "Refunds" },
  { projectId: "project-2", id: "t3", name: "Elsewhere" },
];

/** A Topic delegate that filters seeded rows by project and id, as the reader's query asks. */
function topicTable(rows: readonly SeededTopic[]) {
  return {
    findMany: vi
      .fn()
      .mockImplementation(
        async ({ where }: { where: { projectId: string; id: { in: string[] } } }) =>
          rows
            .filter((row) => row.projectId === where.projectId && where.id.in.includes(row.id))
            .map(({ id, name }) => ({ id, name })),
      ),
  };
}

function contractCases(makeRepository: () => TraceTopicNamesReadRepository): void {
  it("names each asked topic by id", async () => {
    const names = await makeRepository().findNamesByIds({
      projectId: "project-1",
      ids: ["t1", "t2"],
    });

    expect(names).toEqual(
      new Map([
        ["t1", "Billing"],
        ["t2", "Refunds"],
      ]),
    );
  });

  it("leaves out another project's topics", async () => {
    const names = await makeRepository().findNamesByIds({
      projectId: "project-1",
      ids: ["t1", "t3"],
    });

    expect(names).toEqual(new Map([["t1", "Billing"]]));
  });

  it("answers no names for no ids", async () => {
    const names = await makeRepository().findNamesByIds({ projectId: "project-1", ids: [] });

    expect(names).toEqual(new Map());
  });
}

describe("given the trace memory topic-names repository", () => {
  contractCases(() => MemoryTraceTopicNamesRepository.create({ topics: TOPICS }));
});

describe("given the trace Prisma topic-names repository", () => {
  contractCases(() =>
    PrismaTraceTopicNamesRepository.create(prismaDouble({ topic: topicTable(TOPICS) })),
  );
});
