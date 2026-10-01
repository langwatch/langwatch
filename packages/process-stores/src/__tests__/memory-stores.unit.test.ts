import {
  createApp,
  defineRepositories,
  defineServerModule,
  moduleApi,
  type FeatureSetup,
} from "@langwatch/kernel";
import { describe, expect, it } from "vitest";

import type { ObjectStorage } from "../members.ts";
import { memoryStores } from "../memory-stores.ts";
import { StoredObjectNotFoundError } from "../object-storage-backend.ts";

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

interface FilesApi {
  storage(): ObjectStorage;
}

const FilesApi = moduleApi<FilesApi>()("stored-object");

class FilesApp implements FilesApi {
  static readonly contract = FilesApi;
  static readonly dependencies = {};
  static readonly reads = ["objectStorage"] as const;
  readonly #storage: ObjectStorage;

  private constructor(storage: ObjectStorage) {
    this.#storage = storage;
  }

  static create(setup: FeatureSetup<{}, { objectStorage: ObjectStorage }, undefined>): FilesApp {
    return new FilesApp(setup.members.objectStorage);
  }

  storage(): ObjectStorage {
    return this.#storage;
  }
}

const files = defineServerModule("stored-object").withApp(FilesApp).build();

async function* chunks(...values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts).toString("utf8");
}

describe("given a process installed over memory stores", () => {
  describe("when a module reading objectStorage writes, reads, digests and removes", () => {
    /** @scenario "Memory stores answer object storage with its twin" */
    it("answers each operation from the memory twin", async () => {
      const runtime = await createApp({ role: "api" })
        .withModules([files])
        .withStores(memoryStores())
        .boot();
      const at = { projectId: "project-1", key: "project-1/object-1" };

      try {
        const storage = runtime.service(FilesApi).storage();
        const written = await storage.write(at, chunks("hel", "lo"), {
          byteLength: 5,
          contentType: "text/plain",
        });

        expect(written).toEqual({
          byteLength: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        });
        expect(await textOf(await storage.read(at))).toBe("hello");
        await expect(storage.digest(at)).resolves.toEqual(written);
        await expect(storage.destination("project-1")).resolves.toEqual({ kind: "memory" });

        await storage.remove(at);
        await expect(storage.read(at)).rejects.toBeInstanceOf(StoredObjectNotFoundError);
      } finally {
        await runtime.stop();
      }
    });
  });
});

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
