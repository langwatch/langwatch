/**
 * Integration tests for ExperimentService slug deduplication.
 * @see specs/evaluations-v3/experiment-slug-deduplication.feature
 */

import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";
import { ExperimentService } from "../experiment.service";

describe("ExperimentService slug deduplication", () => {
  let project: Project;
  let service: ExperimentService;
  const createdIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("experiment-slug-dedup");
    service = ExperimentService.create(prisma);
  });

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.experiment.deleteMany({
      where: { id: { in: createdIds }, projectId: project.id },
    });
    createdIds.length = 0;
  });

  const createExperiment = async (slug: string, name?: string) => {
    const id = `exp_${nanoid()}`;
    createdIds.push(id);
    return prisma.experiment.create({
      data: {
        id,
        projectId: project.id,
        name: name ?? slug,
        slug,
        type: "BATCH_EVALUATION_V2",
      },
    });
  };

  /** @scenario New experiment gets deduplicated slug when slug conflicts with existing experiment */
  it("appends -2 suffix when base slug already exists", async () => {
    const baseSlug = `dedup-base-${nanoid(6)}`;
    await createExperiment(baseSlug);

    const result = await service.generateUniqueSlug({
      baseSlug,
      projectId: project.id,
    });

    expect(result).toBe(`${baseSlug}-2`);
  });

  /** @scenario Updating an existing experiment does not trigger slug deduplication against itself */
  it("returns the same slug when excluding the experiment that owns it", async () => {
    const baseSlug = `dedup-self-${nanoid(6)}`;
    const existing = await createExperiment(baseSlug);

    const result = await service.generateUniqueSlug({
      baseSlug,
      projectId: project.id,
      excludeExperimentId: existing.id,
    });

    expect(result).toBe(baseSlug);
  });

  /** @scenario Multiple slug conflicts increment the suffix */
  it("increments suffix to -3 when -2 is also taken", async () => {
    const baseSlug = `dedup-multi-${nanoid(6)}`;
    await createExperiment(baseSlug);
    await createExperiment(`${baseSlug}-2`);

    const result = await service.generateUniqueSlug({
      baseSlug,
      projectId: project.id,
    });

    expect(result).toBe(`${baseSlug}-3`);
  });

  /** @scenario Slug with no conflict returns unchanged */
  it("returns the base slug unchanged when no conflict exists", async () => {
    const baseSlug = `dedup-fresh-${nanoid(6)}`;

    const result = await service.generateUniqueSlug({
      baseSlug,
      projectId: project.id,
    });

    expect(result).toBe(baseSlug);
  });

  /** @scenario Unrelated slug sharing the same prefix is not treated as a conflict */
  it("does not treat prefix-sharing slugs as conflicts", async () => {
    const baseSlug = `dedup-prefix-${nanoid(6)}`;
    await createExperiment(`${baseSlug}-extended`);

    const result = await service.generateUniqueSlug({
      baseSlug,
      projectId: project.id,
    });

    expect(result).toBe(baseSlug);
  });
});
