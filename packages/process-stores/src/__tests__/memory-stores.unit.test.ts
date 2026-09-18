import {
  createApp,
  defineRepositories,
  defineServerModule,
  moduleApi,
  type FeatureSetup,
} from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import { memoryStores } from "../memory-stores.ts";

interface ProjectRepository {
  read(): string;
}

interface ProjectApi {
  name(): string;
}

const ProjectApi = moduleApi<ProjectApi>()("project");

class LiveRepositories {
  static readonly requires = ["redis"] as const;

  static create({ redis }: { redis: ProjectRepository }) {
    return { projects: redis };
  }
}

class MemoryRepositories {
  static readonly requires = [] as const;

  static create() {
    return { projects: { read: () => "memory project" } };
  }
}

class ProjectApp implements ProjectApi {
  static readonly contract = ProjectApi;
  static readonly dependencies = {};
  readonly #projects: ProjectRepository;

  private constructor(projects: ProjectRepository) {
    this.#projects = projects;
  }

  static create({
    repositories,
  }: FeatureSetup<{}, unknown, undefined, { projects: ProjectRepository }>): ProjectApp {
    return new ProjectApp(repositories.projects);
  }

  name(): string {
    return this.#projects.read();
  }
}

const project = defineServerModule("project")
  .withRepositories(defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }))
  .withApp(ProjectApp)
  .build();

class StatelessApp {
  static readonly contract = moduleApi<{ ready(): boolean }>()("annotation");
  static readonly dependencies = {};

  static create(_setup: FeatureSetup<{}, unknown, undefined>) {
    return { ready: () => true };
  }
}

const stateless = defineServerModule("annotation").withApp(StatelessApp).build();

describe("memory stores selection", () => {
  /** @scenario "Memory stores select repository twins for every process role" */
  it.each(["api", "worker"] as const)(
    "selects memory repositories without reading Redis in %s",
    async (role) => {
      const runtime = await createApp({ role })
        .withModules([project, stateless])
        .withStores(memoryStores())
        .boot();

      try {
        expect(runtime.service(ProjectApi).name()).toBe("memory project");
        expect(runtime.module(stateless).provided.ready()).toBe(true);
      } finally {
        await runtime.stop();
      }
    },
  );

  /** @scenario "Live stores continue selecting live repositories" */
  it("preserves live selection when the process supplies a live source", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([project])
      .withStores({
        tier: "live",
        order: ["redis"],
        read: () => ({ read: () => "live project" }),
      })
      .boot();

    try {
      expect(runtime.service(ProjectApi).name()).toBe("live project");
    } finally {
      await runtime.stop();
    }
  });
});
