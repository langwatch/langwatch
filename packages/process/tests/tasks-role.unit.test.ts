import { Config, type ConfigOf } from "@langwatch/config";
import { moduleApi } from "@langwatch/module";
/**
 * The tasks role: what a module declares with `withTasks`, and how the process
 * that runs one-shot work reads it back.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../src/application.ts";
import { RoleContributionError } from "../src/boot-errors.ts";
import { defineProcessModule, type FeatureSetup } from "../src/feature-installer.ts";

interface AnnotationApi {
  label(): string;
}
const AnnotationApi = moduleApi<AnnotationApi>()("annotation");

interface DatasetApi {
  label(): string;
}
const DatasetApi = moduleApi<DatasetApi>()("dataset");

/** Stands in for `@langwatch/task`'s Task, which the kernel cannot name. */
class NamedTask {
  constructor(readonly name: string) {}
}

const isNamedTask = (contribution: unknown): contribution is NamedTask =>
  contribution instanceof NamedTask;

class AnnotationModule implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = {};
  static readonly reads = [] as const;
  static create(): AnnotationModule {
    return new AnnotationModule();
  }
  label(): string {
    return "annotation";
  }
}

class DatasetModule implements DatasetApi {
  static readonly contract = DatasetApi;
  static readonly dependencies = {};
  static readonly reads = [] as const;
  static create(): DatasetModule {
    return new DatasetModule();
  }
  label(): string {
    return "dataset";
  }
}

const annotationTask = new NamedTask("dataset-backfill");
const datasetTask = new NamedTask("weekly-report");

const annotation = defineProcessModule("annotation")
  .withApi(AnnotationModule)
  .withTasks(annotationTask);
const dataset = defineProcessModule("dataset").withApi(DatasetModule).withTasks(datasetTask);

describe("given modules that declare one-shot work", () => {
  describe("when a tasks process boots", () => {
    /** @scenario "The tasks role collects the one-shot work modules declared" */
    it("answers with every declared task, in installation order", async () => {
      const runtime = await createApp({ role: "tasks" }).withModules([annotation, dataset]).boot();

      expect(runtime.tasks(isNamedTask)).toEqual([annotationTask, datasetTask]);
      await runtime.stop();
    });
  });

  describe("when the process is not the tasks role", () => {
    /** @scenario "A process that is not the tasks role has no tasks to give" */
    it("refuses, naming the role it actually is", async () => {
      const runtime = await createApp({ role: "worker" }).withModules([annotation]).boot();

      expect(() => runtime.tasks(isNamedTask)).toThrowError(/"worker"/);
      await runtime.stop();
    });
  });

  describe("when a module declared something that is not a task", () => {
    /** @scenario "A module that declared something other than a task is named" */
    it("refuses, naming the module that declared it", async () => {
      const wrong = defineProcessModule("dataset")
        .withApi(DatasetModule)
        .withTasks({ notATask: true });
      const runtime = await createApp({ role: "tasks" }).withModules([wrong]).boot();

      expect(() => runtime.tasks(isNamedTask)).toThrowError(RoleContributionError);
      expect(() => runtime.tasks(isNamedTask)).toThrowError(/dataset/);
      await runtime.stop();
    });
  });
});

describe("given a module that builds its tasks over its own app", () => {
  const bound = defineProcessModule("annotation")
    .withApi(AnnotationModule)
    .withTransports()
    .withTasks(({ app }) => [new NamedTask(`${app.label()}-backfill`)]);

  describe("when a tasks process boots", () => {
    /** @scenario "A module builds its tasks over its own booted app" */
    it("answers with the task built over the booted app", async () => {
      const runtime = await createApp({ role: "tasks" }).withModules([bound, dataset]).boot();

      expect(runtime.tasks(isNamedTask).map((task) => task.name)).toEqual([
        "annotation-backfill",
        "weekly-report",
      ]);
      await runtime.stop();
    });
  });

  describe("when a worker process boots", () => {
    /** @scenario "A task binder is never run outside the tasks role" */
    it("never builds the task", async () => {
      const runtime = await createApp({ role: "worker" }).withModules([bound]).boot();

      expect(() => runtime.tasks(isNamedTask)).toThrowError(/"worker"/);
      await runtime.stop();
    });
  });
});

class ConfiguredAnnotationModule implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = {};
  static readonly config = Config.define((c) => ({
    reportPrefix: c.env("ANNOTATION_REPORT_PREFIX", z.string()),
  }));
  static create(
    _setup: FeatureSetup<
      typeof ConfiguredAnnotationModule.dependencies,
      unknown,
      ConfigOf<typeof ConfiguredAnnotationModule.config>
    >,
  ): ConfiguredAnnotationModule {
    return new ConfiguredAnnotationModule();
  }
  label(): string {
    return "annotation";
  }
}

describe("given a module that declares config and builds its tasks with a binder", () => {
  const configured = defineProcessModule("annotation")
    .withApi(ConfiguredAnnotationModule)
    .withTransports()
    .withTasks(({ app, config }) => [new NamedTask(`${config.reportPrefix}${app.label()}`)]);

  describe("when a tasks process boots with that module's config stated", () => {
    /** @scenario "A task binder is handed its module's parsed config" */
    it("hands the binder the module's parsed config beside its app", async () => {
      const runtime = await createApp({
        role: "tasks",
        config: { annotation: { reportPrefix: "weekly-" } },
      })
        .withModules([configured])
        .boot();

      expect(runtime.tasks(isNamedTask).map((task) => task.name)).toEqual(["weekly-annotation"]);
      await runtime.stop();
    });
  });
});
