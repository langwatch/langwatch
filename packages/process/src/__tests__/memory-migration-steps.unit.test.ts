/**
 * An installed list's migration steps, listed by booting it over memory stores without serving.
 * Spec: packages/process/specs/module-migrations.feature
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { defineProcessModule, type FeatureSetup } from "../feature-installer.ts";
import { migrationStepsOverMemory } from "../migration/memory-migration-steps.ts";
import { defineRepositories } from "../repository-registry.ts";

/** Stands in for `@langwatch/upgrade/step`'s step, which the kernel cannot name. */
class StandInStep {
  constructor(readonly id: string) {}
}
const isStandInStep = (contribution: unknown): contribution is StandInStep =>
  contribution instanceof StandInStep;

interface ProjectSource {
  tier(): string;
}

class LiveRepositories {
  static readonly requires = ["redis"] as const;
  static create({ redis }: { redis: ProjectSource }) {
    return { projects: redis };
  }
}

class MemoryRepositories {
  static readonly requires = [] as const;
  static create(): { projects: ProjectSource } {
    return { projects: { tier: () => "memory" } };
  }
}

class ProjectModule {
  static readonly contract = moduleApi<{ ready(): boolean }>()("project");
  static readonly dependencies = {};
  static create(_setup: FeatureSetup<{}, undefined, { projects: ProjectSource }>) {
    return { ready: () => true };
  }
}

class DatasetModule {
  static readonly contract = moduleApi<{ ready(): boolean }>()("dataset");
  static readonly dependencies = {};
  static create(_setup: FeatureSetup<{}, undefined>) {
    return { ready: () => true };
  }
}

const project = defineProcessModule("project")
  .withRepositories(defineRepositories({ live: LiveRepositories, memory: MemoryRepositories }))
  .withApi(ProjectModule)
  .withTransports()
  .withMigrations(({ repositories }) => [
    new StandInStep(`project:copy-from-${repositories.projects.tier()}`),
  ]);

const dataset = defineProcessModule("dataset")
  .withApi(DatasetModule)
  .withTransports()
  .withMigrations(() => [
    new StandInStep("dataset:copy-keys"),
    new StandInStep("dataset:drop-legacy-keys"),
  ]);

describe("migrationStepsOverMemory", () => {
  describe("when an installed list declares migration steps", () => {
    /** @scenario "An installed list's migration steps are listed over memory stores without serving" */
    it("answers every step once, in installation order, built over the memory repositories", async () => {
      const steps = await migrationStepsOverMemory({
        name: "langwatch-tasks",
        modules: [project, dataset],
        environment: { NODE_ENV: "test" },
        isMigrationStep: isStandInStep,
      });

      expect(steps.map((step) => step.id)).toEqual([
        "project:copy-from-memory",
        "dataset:copy-keys",
        "dataset:drop-legacy-keys",
      ]);
    });
  });
});
