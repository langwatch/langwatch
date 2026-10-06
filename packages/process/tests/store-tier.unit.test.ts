import { moduleApi } from "@langwatch/module";
import { memoryStores } from "@langwatch/process-stores";
import { describe, expect, it } from "vitest";

import { StoreTierUnstatedError } from "../src/boot-errors.ts";
import { bootInstalledProcess } from "../src/boot-installed-process.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";
import { defineRepositories } from "../src/repository-registry.ts";
import { memberSourceOf } from "./member-source.ts";

interface ProjectApi {
  name(): string;
}
const ProjectApi = moduleApi<ProjectApi>()("project");

/** Every repository built, by tier, so a test can say none was. */
const built: string[] = [];

class LiveRepositories {
  static readonly requires = ["redis"] as const;

  static create({ redis }: { redis: { read(): string } }) {
    built.push("live");
    return { projects: redis };
  }
}

class MemoryRepositories {
  static readonly requires = [] as const;

  static create() {
    built.push("memory");
    return { projects: { read: () => "memory project" } };
  }
}

class ProjectApp implements ProjectApi {
  static readonly contract = ProjectApi;
  static readonly dependencies = {};

  private constructor(private readonly projects: { read(): string }) {}

  static create({
    repositories,
  }: FeatureSetup<{}, unknown, undefined, { projects: { read(): string } }>): ProjectApp {
    return new ProjectApp(repositories.projects);
  }

  name(): string {
    return this.projects.read();
  }
}

const project = defineProcessModule("project")
  .withRepositories(defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }))
  .withApi(ProjectApp)
  .build();

describe("given a module that declares live and memory repositories", () => {
  describe("when its stores state no tier and its caller asked for none", () => {
    /** @scenario "A module with repositories refuses to boot where no store tier was stated" */
    it("refuses by module name and builds no repository of either tier", async () => {
      built.length = 0;
      const boot = bootInstalledProcess({
        role: "api",
        modules: [project],
        config: {},
        members: memberSourceOf<Record<string, unknown>>({ redis: { read: () => "live project" } }),
      });

      await expect(boot).rejects.toThrow(StoreTierUnstatedError);
      await expect(boot).rejects.toMatchObject({
        name: "StoreTierUnstatedError",
        module: "project",
      });
      expect(built).toEqual([]);
    });
  });

  describe("when a harness boots it over memory stores and states nothing else", () => {
    /** @scenario "A harness reaches memory only by handing memory stores" */
    it("runs the module on its memory repositories", async () => {
      built.length = 0;
      const runtime = await bootInstalledProcess({
        role: "worker",
        modules: [project],
        config: {},
        members: { ...memoryStores(), close: async () => void 0 },
      });

      try {
        expect(runtime.service(ProjectApi).name()).toBe("memory project");
        expect(built).toEqual(["memory"]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
