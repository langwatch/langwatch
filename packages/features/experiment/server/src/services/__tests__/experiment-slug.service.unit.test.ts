/**
 * @see specs/experiments-v3/experiment-slug-deduplication.feature
 *
 * Ported from
 * `platform/app/src/server/experiments/__tests__/experiment-slug-deduplication.integration.test.ts`,
 * which drove the same logic through a real Postgres repository. The service
 * only reads `findSlugsByPrefix`, so a fake repository proves the same
 * behaviour without a datastore.
 */
import { describe, expect, it } from "vitest";
import { ExperimentSlugService, type ExperimentSlugRepository } from "../experiment-slug.service";

const repositoryOf = (slugs: string[]): ExperimentSlugRepository => ({
  findSlugsByPrefix: async (input) =>
    slugs.filter((slug) => slug === input.slugPrefix || slug.startsWith(`${input.slugPrefix}-`)),
});

describe("ExperimentSlugService", () => {
  /** @scenario New experiment gets deduplicated slug when slug conflicts with existing experiment */
  it("appends -2 suffix when base slug already exists", async () => {
    const slugs = ExperimentSlugService.create({
      repository: repositoryOf(["dedup-base"]),
      newId: () => "fallback",
    });

    const result = await slugs.generateUnique({
      baseSlug: "dedup-base",
      projectId: "project_1",
    });

    expect(result).toBe("dedup-base-2");
  });

  /** @scenario Updating an existing experiment does not trigger slug deduplication against itself */
  it("returns the same slug when excluding the experiment that owns it", async () => {
    const repository: ExperimentSlugRepository = {
      findSlugsByPrefix: async (input) => (input.excludeId === "existing" ? [] : ["dedup-self"]),
    };
    const slugs = ExperimentSlugService.create({ repository, newId: () => "fallback" });

    const result = await slugs.generateUnique({
      baseSlug: "dedup-self",
      projectId: "project_1",
      excludeExperimentId: "existing",
    });

    expect(result).toBe("dedup-self");
  });

  /** @scenario Multiple slug conflicts increment the suffix */
  it("increments suffix to -3 when -2 is also taken", async () => {
    const slugs = ExperimentSlugService.create({
      repository: repositoryOf(["dedup-multi", "dedup-multi-2"]),
      newId: () => "fallback",
    });

    const result = await slugs.generateUnique({
      baseSlug: "dedup-multi",
      projectId: "project_1",
    });

    expect(result).toBe("dedup-multi-3");
  });

  /** @scenario Slug with no conflict returns unchanged */
  it("returns the base slug unchanged when no conflict exists", async () => {
    const slugs = ExperimentSlugService.create({
      repository: repositoryOf([]),
      newId: () => "fallback",
    });

    const result = await slugs.generateUnique({
      baseSlug: "dedup-fresh",
      projectId: "project_1",
    });

    expect(result).toBe("dedup-fresh");
  });

  /** @scenario Unrelated slug sharing the same prefix is not treated as a conflict */
  it("does not treat prefix-sharing slugs as conflicts", async () => {
    const slugs = ExperimentSlugService.create({
      repository: repositoryOf(["dedup-prefix-extended"]),
      newId: () => "fallback",
    });

    const result = await slugs.generateUnique({
      baseSlug: "dedup-prefix",
      projectId: "project_1",
    });

    expect(result).toBe("dedup-prefix");
  });
});
