/**
 * @vitest-environment node
 * Trace's plan-limit refusal counter: the memory twin's contract. The Postgres twin runs the
 * same cases in prisma/__tests__/prisma.trace-plan-limit-refusals.repository.integration.test.ts.
 */
import { describe } from "vitest";

import { MemoryTracePlanLimitRefusalsRepository } from "../../../../repositories/memory/memory.trace-plan-limit-refusals.repository.ts";
import { describePlanLimitRefusalsContract } from "./trace-plan-limit-refusals.repository.contract.ts";

let next = 0;

describe("given the memory trace plan-limit refusal counter", () => {
  describePlanLimitRefusalsContract({
    create: () => MemoryTracePlanLimitRefusalsRepository.create(),
    projectId: () => `project-${(next += 1)}`,
  });
});
