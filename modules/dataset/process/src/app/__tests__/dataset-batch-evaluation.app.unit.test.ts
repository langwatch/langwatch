/**
 * @vitest-environment node
 * What a dataset evaluation reads and writes here: the dataset its slug names,
 * and the batch-evaluation row each evaluated entry leaves behind.
 * @see modules/dataset/specs/dataset-service.feature
 */
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDatasetRepositories } from "../../repositories/memory/memory.dataset.repositories.ts";
import { createDatasetTestApp } from "./dataset.fixture.ts";

const columnTypes = [{ name: "input", type: "string" as const }];

async function harness() {
  const repositories = MemoryDatasetRepositories.create();
  const app = createDatasetTestApp({ repositories });
  const dataset = await repositories.datasets.create({
    projectId: "project-1",
    name: "Golden set",
    slug: "golden-set",
    columnTypes,
  });

  return { app, repositories, dataset };
}

describe("given a dataset evaluation names a dataset by slug", () => {
  /** @scenario "A dataset evaluation finds its dataset by slug alone" */
  it("answers the dataset holding exactly that slug", async () => {
    const { app, dataset } = await harness();

    await expect(app.findBySlug({ projectId: "project-1", slug: "golden-set" })).resolves.toEqual([
      expect.objectContaining({ id: dataset.id, slug: "golden-set" }),
    ]);
  });

  /** @scenario "A dataset evaluation finds its dataset by slug alone" */
  it("answers none for the dataset's id, which is not its slug", async () => {
    const { app, dataset } = await harness();

    await expect(app.findBySlug({ projectId: "project-1", slug: dataset.id })).resolves.toEqual([]);
  });

  /** @scenario "A dataset evaluation finds its dataset by slug alone" */
  it("answers an archived dataset still holding the slug, as main did", async () => {
    const { app, repositories, dataset } = await harness();
    await repositories.datasets.archive({
      id: dataset.id,
      projectId: "project-1",
      slug: "golden-set",
      archivedAt: nowInstant(),
    });

    await expect(app.findBySlug({ projectId: "project-1", slug: "golden-set" })).resolves.toEqual([
      expect.objectContaining({ id: dataset.id }),
    ]);
  });

  /** @scenario "A dataset evaluation finds its dataset by slug alone" */
  it("answers none for another project", async () => {
    const { app } = await harness();

    await expect(app.findBySlug({ projectId: "project-2", slug: "golden-set" })).resolves.toEqual(
      [],
    );
  });
});

describe("given a dataset evaluation scored one entry", () => {
  /** @scenario "A dataset evaluation records each scored entry as a batch-evaluation row" */
  it("reads the row back under the experiment it ran in, beside its dataset", async () => {
    const { app, dataset } = await harness();

    await app.createBatchEvaluation({
      id: "batch-1",
      experimentId: "experiment-1",
      projectId: "project-1",
      data: { input: "hello" },
      status: "processed",
      score: 0.8,
      passed: true,
      label: null,
      details: "",
      cost: 0.01,
      evaluation: "langevals/exact_match",
      datasetSlug: "golden-set",
      datasetId: dataset.id,
    });

    await expect(
      app.listBatchEvaluations({ projectId: "project-1", experimentSlug: "nightly" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "batch-1",
        status: "processed",
        score: 0.8,
        data: { input: "hello" },
        dataset: { id: dataset.id, name: "Golden set", slug: "golden-set" },
      }),
    ]);
  });
});
