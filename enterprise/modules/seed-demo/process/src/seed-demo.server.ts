// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { SeedDemoApp } from "./app/seed-demo.app.ts";
import { seedDemoEventing } from "./eventing/seed-demo.pipeline.ts";
import { SeedDemoTask } from "./tasks/seed-demo.task.ts";

export const seedDemoServer = defineServerModule("seed-demo")
  .withApp(SeedDemoApp)
  .withEventing(seedDemoEventing)
  .withTasks(({ app }: { app: unknown }) => {
    if (!(app instanceof SeedDemoApp))
      throw new TypeError("The seed-demo task needs the SeedDemoApp it installed");
    return [SeedDemoTask.create({ seeds: app })];
  });
