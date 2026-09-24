/**
 * The tasks role: what a module declares with `withTasks`, and how the process
 * that runs one-shot work reads it back.
 * Spec: specs/server/declarative-process-composition.feature
 */
import { describe, expect, it } from "vitest";

import { createApp } from "../src/application.ts";
import { RoleContributionError } from "../src/boot-errors.ts";
import { defineServerModule } from "../src/feature-installer.ts";
import { moduleApi } from "../src/module-api-token.ts";

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

class AnnotationApp implements AnnotationApi {
  static readonly contract = AnnotationApi;
  static readonly dependencies = {};
  static readonly reads = [] as const;
  static create(): AnnotationApp {
    return new AnnotationApp();
  }
  label(): string {
    return "annotation";
  }
}

class DatasetApp implements DatasetApi {
  static readonly contract = DatasetApi;
  static readonly dependencies = {};
  static readonly reads = [] as const;
  static create(): DatasetApp {
    return new DatasetApp();
  }
  label(): string {
    return "dataset";
  }
}

const annotationTask = new NamedTask("dataset-backfill");
const datasetTask = new NamedTask("weekly-report");

const annotation = defineServerModule("annotation")
  .withApp(AnnotationApp)
  .withTasks(annotationTask);
const dataset = defineServerModule("dataset").withApp(DatasetApp).withTasks(datasetTask);

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
      const wrong = defineServerModule("dataset").withApp(DatasetApp).withTasks({ notATask: true });
      const runtime = await createApp({ role: "tasks" }).withModules([wrong]).boot();

      expect(() => runtime.tasks(isNamedTask)).toThrowError(RoleContributionError);
      expect(() => runtime.tasks(isNamedTask)).toThrowError(/dataset/);
      await runtime.stop();
    });
  });
});

describe("given a module that builds its tasks over its own app", () => {
  const bound = defineServerModule("annotation")
    .withApp(AnnotationApp)
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
