/** The cases every trace plan-limit refusal counter answers alike. */
import { expect, it } from "vitest";

import type { TracePlanLimitRefusalsRepository } from "../trace-plan-limit-refusals.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (n: number) => Date.UTC(2026, 10, 1) + n * DAY_MS;

export function describePlanLimitRefusalsContract({
  create,
  projectId,
}: {
  create: () => TracePlanLimitRefusalsRepository;
  projectId: () => string;
}): void {
  it("sums each project's own refusals over the days inside the range", async () => {
    const repository = create();
    const project = projectId();
    const other = projectId();
    const quiet = projectId();

    await repository.recordRefusal({ projectId: project, dayStartMs: day(0) });
    await repository.recordRefusal({ projectId: project, dayStartMs: day(1) });
    await repository.recordRefusal({ projectId: project, dayStartMs: day(1) });
    await repository.recordRefusal({ projectId: project, dayStartMs: day(2) });
    await repository.recordRefusal({ projectId: project, dayStartMs: day(5) });
    await repository.recordRefusal({ projectId: other, dayStartMs: day(1) });

    const counts = await repository.countRefusals({
      projectIds: [project, other, quiet],
      fromDayMs: day(1),
      toDayMs: day(2),
    });

    expect(counts.get(project)).toBe(3);
    expect(counts.get(other)).toBe(1);
    expect(counts.get(quiet) ?? 0).toBe(0);
  });

  it("counts concurrent refusals on the same day without losing one", async () => {
    const repository = create();
    const project = projectId();

    await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.recordRefusal({ projectId: project, dayStartMs: day(3) }),
      ),
    );

    const counts = await repository.countRefusals({
      projectIds: [project],
      fromDayMs: day(3),
      toDayMs: day(3),
    });
    expect(counts.get(project)).toBe(10);
  });
}
