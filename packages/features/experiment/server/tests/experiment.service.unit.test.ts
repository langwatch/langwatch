import { describe, expect, it } from "vitest";
import type {
  Experiment,
  SaveExperimentInput,
} from "@langwatch/experiment-contract";
import type {
  ExperimentRepository,
  ExperimentRowState,
} from "../src/repositories/experiment.repository";
import { ExperimentService } from "../src/services/experiment.service";

const row = (overrides: Partial<Experiment> = {}): Experiment => ({
  id: "experiment_1",
  name: "Draft",
  type: "EVALUATIONS_V3",
  slug: "draft",
  projectId: "project_1",
  workflowId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  workbenchState: null,
  ...overrides,
});

class MemoryExperimentRepository implements ExperimentRepository {
  values: Experiment[] = [];
  states = new Map<string, ExperimentRowState>();

  async tryFindById(input: { id: string; projectId: string }) {
    return (
      this.values.find(
        (value) =>
          value.id === input.id && value.projectId === input.projectId,
      ) ?? null
    );
  }
  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
    type?: Experiment["type"];
  }) {
    return (
      this.values.find(
        (value) =>
          value.slug === input.slug &&
          value.projectId === input.projectId &&
          (!input.type || value.type === input.type),
      ) ?? null
    );
  }
  async findAll(input: { projectId: string }) {
    return this.values.filter((value) => value.projectId === input.projectId);
  }
  async findPage(input: { projectId: string; skip: number; take: number }) {
    return (await this.findAll(input)).slice(input.skip, input.skip + input.take);
  }
  async count(input: { projectId: string }) {
    return (await this.findAll(input)).length;
  }
  async tryFindLatest(input: { projectId: string }) {
    return (await this.findAll(input)).at(-1) ?? null;
  }
  async tryFindForWorkflow(input: {
    projectId: string;
    workflowId: string;
  }) {
    return (
      this.values.find(
        (value) =>
          value.projectId === input.projectId &&
          value.workflowId === input.workflowId,
      ) ?? null
    );
  }
  async tryFindIdBySlug(input: { projectId: string; slug: string }) {
    const value = await this.tryFindBySlug(input);
    return value ? { id: value.id, slug: value.slug } : null;
  }
  async tryGetRowState(input: { projectId: string; id: string }) {
    return this.states.get(`${input.projectId}:${input.id}`) ?? null;
  }
  async findSlugsByPrefix(input: { projectId: string; slugPrefix: string }) {
    return this.values
      .filter(
        (value) =>
          value.projectId === input.projectId &&
          value.slug.startsWith(input.slugPrefix),
      )
      .map((value) => value.slug);
  }
  async findDraftNames(input: { projectId: string }) {
    return (await this.findAll(input)).map((value) => ({ name: value.name }));
  }
  async findAllSlugs(input: { projectId: string }) {
    return (await this.findAll(input)).map((value) => value.slug);
  }
  async saveActive(input: SaveExperimentInput & { slug: string }) {
    const value = row({ ...input, slug: input.slug });
    this.values = this.values.filter((item) => item.id !== value.id);
    this.values.push(value);
    this.states.set(`${value.projectId}:${value.id}`, {
      slug: value.slug,
      workflowId: value.workflowId,
      archived: false,
    });
    return value;
  }
  async updateWorkbenchState(input: {
    projectId: string;
    id: string;
    workbenchState: SaveExperimentInput["workbenchState"];
  }) {
    const value = await this.tryFindById(input);
    if (value) value.workbenchState = input.workbenchState;
  }
  async archiveActive(input: {
    projectId: string;
    id: string;
    archivedSlug: string;
    archivedAt: Date;
  }) {
    const state = await this.tryGetRowState(input);
    if (!state || state.archived) return false;
    this.states.set(`${input.projectId}:${input.id}`, {
      ...state,
      slug: input.archivedSlug,
      archived: true,
    });
    return true;
  }
}

const build = (repository = new MemoryExperimentRepository()) => {
  return {
    repository,
    service: ExperimentService.create({
      repository,
      slugify: (value) => value.toLowerCase().replaceAll(" ", "-"),
      newId: () => "generated",
      now: () => new Date(1),
    }),
  };
};

describe("ExperimentService", () => {
  it("deduplicates slugs inside a project", async () => {
    const { repository, service } = build();
    repository.values.push(row());
    const saved = await service.save({
      id: "experiment_2",
      projectId: "project_1",
      name: "Draft",
      type: "EVALUATIONS_V3",
      requestedSlug: "draft",
      slugMode: "deduplicate",
      workflowId: null,
      workbenchState: null,
    });
    expect(saved.slug).toBe("draft-2");
  });

  it("archives only the Experiment row", async () => {
    const { repository, service } = build();
    repository.states.set("project_1:experiment_1", {
      slug: "draft",
      workflowId: "workflow_1",
      archived: false,
    });
    await expect(
      service.archive({ projectId: "project_1", id: "experiment_1" }),
    ).resolves.toEqual({ success: true });
    expect(await repository.tryGetRowState({
      projectId: "project_1",
      id: "experiment_1",
    })).toMatchObject({ archived: true });
  });
});
