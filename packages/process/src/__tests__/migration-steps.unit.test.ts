/**
 * What a module declares with `.withMigrations`, which roles build it, and how the installed
 * list's steps are collected and refused.
 * Spec: packages/process/specs/module-migrations.feature
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { ApplicationBuilder } from "../application.ts";
import {
  defineProcessModule,
  type InstalledFeatureState,
  type ServerRole,
} from "../feature-installer.ts";
import {
  MigrationStepCollectionError,
  collectMigrationSteps,
  migrationStepsOf,
} from "../migration-steps.ts";
import { ResourceScope } from "../resource-scope.ts";

interface DatasetApi {
  label(): string;
}
const DatasetApi = moduleApi<DatasetApi>()("dataset");

class DatasetModule implements DatasetApi {
  static readonly contract = DatasetApi;
  static readonly dependencies = {};
  static create(): DatasetModule {
    return new DatasetModule();
  }
  label(): string {
    return "dataset";
  }
}

/** Stands in for `@langwatch/upgrade/step`'s step, which the kernel cannot name. */
class StandInStep {
  constructor(readonly id: string) {}
}
const isStandInStep = (contribution: unknown): contribution is StandInStep =>
  contribution instanceof StandInStep;

function declaringTwoSteps() {
  const built: string[] = [];
  const declaration = defineProcessModule("dataset")
    .withApi(DatasetModule)
    .withTransports()
    .withMigrations(({ app }) => {
      built.push(app.label());
      return [
        new StandInStep(`dataset:${app.label()}-copy-keys`),
        new StandInStep("dataset:drop-legacy-keys"),
      ];
    });
  return { declaration, built };
}

async function installIn(role: ServerRole): Promise<{
  state: InstalledFeatureState;
  built: readonly string[];
}> {
  const { declaration, built } = declaringTwoSteps();
  const state = await declaration.install({
    resources: new ResourceScope(),
    config: undefined,
    members: {} as never,
    role,
    resolve: () => undefined,
  });
  return { state, built };
}

function refusalOf(collect: () => unknown): MigrationStepCollectionError {
  try {
    collect();
  } catch (error) {
    if (error instanceof MigrationStepCollectionError) return error;
    throw error;
  }
  throw new Error("expected collection to refuse");
}

describe("given a module that declares its migration steps over its own app", () => {
  describe("when a tasks process installs it", () => {
    /** @scenario "A module builds its migration steps over its own booted app" */
    it("builds the steps over the app it just installed", async () => {
      const { state, built } = await installIn("tasks");

      expect(built).toEqual(["dataset"]);
      expect(state.migrationSteps).toEqual([
        new StandInStep("dataset:dataset-copy-keys"),
        new StandInStep("dataset:drop-legacy-keys"),
      ]);
    });
  });

  describe("when it is installed in each role", () => {
    /** @scenario "The tasks and worker roles build a module's migration steps and the api never does" */
    it("builds both steps in tasks and worker, in order, and never runs the binder in the api", async () => {
      const tasks = await installIn("tasks");
      const worker = await installIn("worker");
      const api = await installIn("api");
      const ids = ({ state }: { state: InstalledFeatureState }) =>
        collectMigrationSteps({
          declared: [{ module: "dataset", steps: state.migrationSteps ?? [] }],
          isMigrationStep: isStandInStep,
        }).map((step) => step.id);

      expect(ids(tasks)).toEqual(["dataset:dataset-copy-keys", "dataset:drop-legacy-keys"]);
      expect(ids(worker)).toEqual(["dataset:dataset-copy-keys", "dataset:drop-legacy-keys"]);
      expect(api.state.migrationSteps).toBeUndefined();
      expect(api.built).toEqual([]);
      expect(() =>
        migrationStepsOf({
          process: "langwatch-api",
          role: "api",
          installed: new Map([["dataset", api.state]]),
          isMigrationStep: isStandInStep,
        }),
      ).toThrowError(/"api"/);
    });

    it("boots a worker process over the module without disturbing its other work", async () => {
      const { declaration, built } = declaringTwoSteps();
      const runtime = await new ApplicationBuilder({ role: "worker" })
        .withModules([declaration])
        .boot();

      expect(built).toEqual(["dataset"]);
      await runtime.stop();
    });
  });
});

describe("given the installed list's declared steps", () => {
  describe("when two modules each declare steps", () => {
    /** @scenario "Migration steps are collected over the installed list in installation order" */
    it("answers every step once, in installation order", () => {
      const installed = new Map<string, InstalledFeatureState>([
        ["dataset", stateWith([new StandInStep("dataset:copy-keys")])],
        [
          "evaluation",
          stateWith([
            new StandInStep("evaluation:backfill-scores"),
            new StandInStep("evaluation:enrol-tenants"),
          ]),
        ],
        ["annotation", stateWith(undefined)],
      ]);

      const steps = migrationStepsOf({
        process: "langwatch-tasks",
        role: "tasks",
        installed,
        isMigrationStep: isStandInStep,
      });

      expect(steps.map((step) => step.id)).toEqual([
        "dataset:copy-keys",
        "evaluation:backfill-scores",
        "evaluation:enrol-tenants",
      ]);
    });
  });

  describe("when a step id is not prefixed with its declaring module", () => {
    /** @scenario "A step id not prefixed with its declaring module is refused by name" */
    it("refuses, naming the module and the step", () => {
      const refusal = refusalOf(() =>
        collectMigrationSteps({
          declared: [{ module: "dataset", steps: [new StandInStep("annotation:copy-keys")] }],
          isMigrationStep: isStandInStep,
        }),
      );

      expect(refusal.code).toBe("migration_step_collection_refused");
      expect(refusal.refusal).toBe("foreign_prefix");
      expect(refusal.module).toBe("dataset");
      expect(refusal.step).toBe("annotation:copy-keys");
    });
  });

  describe("when a step id is declared twice", () => {
    /** @scenario "A step id declared twice across the installed list is refused by name" */
    it("refuses, naming the module and the step", () => {
      const refusal = refusalOf(() =>
        collectMigrationSteps({
          declared: [
            {
              module: "dataset",
              steps: [new StandInStep("dataset:copy-keys"), new StandInStep("dataset:copy-keys")],
            },
          ],
          isMigrationStep: isStandInStep,
        }),
      );

      expect(refusal.refusal).toBe("duplicate_id");
      expect(refusal.module).toBe("dataset");
      expect(refusal.step).toBe("dataset:copy-keys");
    });
  });

  describe("when a module declared something that is not a step", () => {
    /** @scenario "A module that declared something other than a migration step is named" */
    it("refuses, naming the module", () => {
      const refusal = refusalOf(() =>
        collectMigrationSteps({
          declared: [{ module: "dataset", steps: [{ id: "dataset:copy-keys" }] }],
          isMigrationStep: isStandInStep,
        }),
      );

      expect(refusal.refusal).toBe("not_a_step");
      expect(refusal.module).toBe("dataset");
      expect(refusal.step).toBe("dataset:copy-keys");
    });
  });
});

function stateWith(migrationSteps: readonly unknown[] | undefined): InstalledFeatureState {
  return {
    provided: undefined,
    ...(migrationSteps ? { migrationSteps } : {}),
    rest: undefined,
    trpc: undefined,
    worker: undefined,
  };
}
