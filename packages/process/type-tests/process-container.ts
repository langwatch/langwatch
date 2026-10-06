import { expectTypeOf } from "vitest";

import type {
  ApiProcessContainer,
  BootedApplication,
  TasksProcessContainer,
  WorkerProcessContainer,
} from "../src/process-container.ts";
import { LicenseSource, ProjectApi } from "../tests/process-supply.fixtures.ts";

type Booted<Container extends { boot(): Promise<unknown> }> = Awaited<
  ReturnType<Container["boot"]>
>;

declare const api: Booted<ApiProcessContainer>;
declare const worker: Booted<WorkerProcessContainer>;
declare const tasks: Booted<TasksProcessContainer>;

// Every booted container answers a module's Api by its token, typed by the token.
expectTypeOf(api.service(ProjectApi)).toEqualTypeOf<ProjectApi>();
expectTypeOf(worker.service(ProjectApi)).toEqualTypeOf<ProjectApi>();
expectTypeOf(tasks.service(ProjectApi)).toEqualTypeOf<ProjectApi>();

// The accessor reaches module Apis only: a supply token stays inside the process.
// @ts-expect-error a supply token is not a module Api
void worker.service(LicenseSource);

// Only the tasks role answers `tasks`; nothing else of the runtime leaks out.
expectTypeOf(tasks).toEqualTypeOf<BootedApplication>();
expectTypeOf(api).not.toHaveProperty("tasks");
expectTypeOf(worker).not.toHaveProperty("tasks");
expectTypeOf(worker).not.toHaveProperty("members");
expectTypeOf(worker).not.toHaveProperty("module");
expectTypeOf(worker).not.toHaveProperty("transports");
expectTypeOf(api).not.toHaveProperty("contributions");
