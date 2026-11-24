/**
 * @vitest-environment node
 * The `dataset:fill-empty-slugs` step over the memory twins: datasets stored with an empty slug
 * get the slug their name gives, numbered past one the project holds.
 */
import type { ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { MemoryDatasetRepository } from "../../repositories/memory/memory.dataset.repository.ts";
import { DatasetEmptySlugService } from "../dataset-empty-slug.service.ts";

const PROJECT = "project-1";
const OTHER = "project-2";

let database: MemoryDatasetDatabase;
let datasets: MemoryDatasetRepository;

const projects: Pick<ProjectApi, "listAllIds"> = {
  listAllIds: async (input) => ({
    ids: [PROJECT, OTHER].filter((id) => !input?.after || id > input.after),
    next: null,
  }),
};

/** A row as an old release stored it: the read-back refuses its empty slug, the row is kept. */
function stored({ id, name, slug, projectId = PROJECT }: StoredRow): void {
  const now = new Date(Date.UTC(2026, 0, 1));
  database.putDataset({
    id,
    projectId,
    name,
    slug,
    columnTypes: [],
    mapping: null,
    useS3: false,
    s3RecordCount: null,
    contentLayout: "postgres",
    status: "ready",
    statusError: null,
    stagingKey: null,
    uploadFilename: null,
    sourceStoredObjectId: null,
    rowCount: null,
    sizeBytes: null,
    chunkCount: null,
    chunkOffsets: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}
type StoredRow = { id: string; name: string; slug: string; projectId?: string };

const slugOf = (id: string, projectId = PROJECT) =>
  database.datasets().find((row) => row.id === id && row.projectId === projectId)?.slug;

function run({
  resumeFrom = null,
  dryRun = false,
  saved = [],
}: {
  resumeFrom?: MigrationStepReport | null;
  dryRun?: boolean;
  saved?: MigrationStepReport[];
} = {}) {
  return DatasetEmptySlugService.create({ datasets, projects })
    .runStep({
      checkpoint: { resumeFrom, save: async ({ report }) => void saved.push(report) },
      dryRun,
      signal: new AbortController().signal,
      log: { info: () => undefined, warn: () => undefined },
    })
    .then((report) => ({ report, saved }));
}

beforeEach(() => {
  database = MemoryDatasetDatabase.create();
  datasets = MemoryDatasetRepository.create({ database });
});

describe("when datasets are stored with an empty slug", () => {
  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("gives each the slug its name gives, as creating a dataset would", async () => {
    stored({ id: "a", name: "Support Questions", slug: "" });
    stored({ id: "b", name: "Customer FAQ", slug: "", projectId: OTHER });

    const { report } = await run();

    expect(report).toMatchObject({ filled: 2, failed: 0 });
    expect(slugOf("a")).toBe("support-questions");
    expect(slugOf("b", OTHER)).toBe("customer-faq");
    await expect(
      datasets.findBySlug({ projectId: PROJECT, slug: "support-questions" }),
    ).resolves.toMatchObject({ id: "a", name: "Support Questions" });
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("numbers past a slug the project already holds, archived datasets included", async () => {
    stored({ id: "taken", name: "Support questions", slug: "support-questions" });
    stored({ id: "archived", name: "Support questions 2", slug: "support-questions-2" });
    database.putDataset({ ...database.getDataset(PROJECT, "archived"), archivedAt: new Date() });
    stored({ id: "first", name: "Support questions", slug: "" });
    stored({ id: "second", name: "support  QUESTIONS", slug: "" });

    await run();

    expect(slugOf("taken")).toBe("support-questions");
    expect(slugOf("first")).toBe("support-questions-3");
    expect(slugOf("second")).toBe("support-questions-4");
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("uses the same slug in another project, which holds its own slugs", async () => {
    stored({ id: "here", name: "Support questions", slug: "support-questions" });
    stored({ id: "there", name: "Support questions", slug: "", projectId: OTHER });

    await run();

    expect(slugOf("there", OTHER)).toBe("support-questions");
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("gives a name with no letters or digits the slug dataset, numbered when taken", async () => {
    stored({ id: "named", name: "dataset", slug: "dataset" });
    stored({ id: "symbols", name: "!!!", slug: "" });
    stored({ id: "blank", name: "", slug: "" });

    await run();

    expect(slugOf("blank")).toBe("dataset-2");
    expect(slugOf("symbols")).toBe("dataset-3");
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("leaves a dataset that has a slug as it is", async () => {
    stored({ id: "kept", name: "Renamed later", slug: "original-name" });

    const { report } = await run();

    expect(report).toMatchObject({ filled: 0 });
    expect(slugOf("kept")).toBe("original-name");
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("changes nothing on a second run", async () => {
    stored({ id: "a", name: "Support questions", slug: "" });

    await run();
    const again = await run();

    expect(again.report).toMatchObject({ filled: 0, failed: 0 });
    expect(slugOf("a")).toBe("support-questions");
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("changes nothing and saves no checkpoint on a dry run", async () => {
    stored({ id: "a", name: "Support questions", slug: "" });

    const { report, saved } = await run({ dryRun: true });

    expect(report).toMatchObject({ wouldFill: 1, filled: 0, dryRun: true });
    expect(saved).toEqual([]);
    expect(slugOf("a")).toBe("");
  });

  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("saves a checkpoint after each project and resumes after the one it names", async () => {
    stored({ id: "a", name: "Before", slug: "" });
    stored({ id: "b", name: "After", slug: "", projectId: OTHER });

    const { saved } = await run({ resumeFrom: { afterProjectId: PROJECT } });

    expect(slugOf("a")).toBe("");
    expect(slugOf("b", OTHER)).toBe("after");
    expect(saved.map((report) => report.afterProjectId)).toEqual([OTHER]);
  });
});

describe("when a dataset finds no free slug on the first attempt", () => {
  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("reports every slug filled across the attempts once the retry completes", async () => {
    stored({ id: "a", name: "First", slug: "" });
    stored({ id: "stuck", name: "Stuck", slug: "" });
    stored({ id: "b", name: "Other", slug: "", projectId: OTHER });
    const fill = datasets.fillEmptySlug.bind(datasets);
    let stuck = true;
    vi.spyOn(datasets, "fillEmptySlug").mockImplementation(async (input) =>
      input.id === "stuck" && stuck ? "taken" : fill(input),
    );

    const saved: MigrationStepReport[] = [];
    await expect(run({ saved })).rejects.toThrow("1 datasets with an empty slug got none");
    const ledger = saved.at(-1) ?? null;
    expect(ledger).toMatchObject({ filled: 2 });
    expect(ledger?.afterProjectId).toBeUndefined();

    stuck = false;
    const { report } = await run({ resumeFrom: ledger });

    expect(report).toMatchObject({ filled: 3, failed: 0 });
  });
});

describe("when a slug write throws partway through a project", () => {
  /** @scenario "A dataset stored with an empty slug gets a slug from its name" */
  it("saves the slugs already filled before the error, so the retry counts them", async () => {
    stored({ id: "a", name: "First", slug: "" });
    stored({ id: "boom", name: "Boom", slug: "" });
    const fill = datasets.fillEmptySlug.bind(datasets);
    const failure = new Error("slug write failed");
    let broken = true;
    vi.spyOn(datasets, "fillEmptySlug").mockImplementation(async (input) => {
      if (input.id === "boom" && broken) throw failure;
      return fill(input);
    });

    const saved: MigrationStepReport[] = [];
    await expect(run({ saved })).rejects.toBe(failure);
    expect(saved.at(-1)).toMatchObject({ filled: 1 });

    broken = false;
    const { report } = await run({ resumeFrom: saved.at(-1) ?? null });

    expect(report).toMatchObject({ filled: 2, failed: 0 });
  });
});
