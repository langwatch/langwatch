import { SuiteNameTakenError, SuiteNotFoundError, type Suite } from "@langwatch/suite-contract";
import { describe, expect, it, vi } from "vitest";
import { SuiteRepository } from "../src/repositories/suite.repository";
import { SuiteService } from "../src/services/suite.service";

const suite = (overrides: Partial<Suite> = {}): Suite => ({
  id: "suite_original",
  projectId: "project_1",
  name: "Critical path",
  slug: "critical-path",
  description: null,
  scenarioIds: ["scenario_1"],
  targets: [{ type: "prompt", referenceId: "prompt_1" }],
  repeatCount: 1,
  labels: [],
  simulatorModel: null,
  judgeModel: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function repository(overrides: Partial<SuiteRepository> = {}): SuiteRepository {
  return {
    create: vi.fn(),
    list: vi.fn(),
    tryFindById: vi.fn(),
    tryFindBySlug: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    archive: vi.fn(),
    ...overrides,
  } as SuiteRepository;
}

describe("SuiteService", () => {
  it("creates a slugged suite through its own repository", async () => {
    const repo = repository({ create: vi.fn().mockImplementation(async (input) => suite(input)) });
    const service = SuiteService.create({ repository: repo, generateId: () => "suite_created" });

    const created = await service.create({
      projectId: "project_1",
      name: "Critical path",
      scenarioIds: ["scenario_1"],
      targets: [{ type: "prompt", referenceId: "prompt_1" }],
    });

    expect(created.id).toBe("suite_created");
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ slug: "critical-path" }));
  });

  it("throws a domain error when a definition is absent", async () => {
    const service = SuiteService.create({ repository: repository({ tryFindById: vi.fn().mockResolvedValue(null) }) });
    await expect(service.get({ id: "suite_missing", projectId: "project_1" })).rejects.toBeInstanceOf(SuiteNotFoundError);
  });

  it("rejects an occupied slug", async () => {
    const service = SuiteService.create({ repository: repository({ tryFindBySlug: vi.fn().mockResolvedValue(suite()) }) });
    await expect(service.create({ projectId: "project_1", name: "Critical path", scenarioIds: ["scenario_1"], targets: [{ type: "prompt", referenceId: "prompt_1" }] })).rejects.toBeInstanceOf(SuiteNameTakenError);
  });
});
