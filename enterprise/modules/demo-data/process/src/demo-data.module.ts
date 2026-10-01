// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineProcessModule } from "@langwatch/process";

import { DemoDataModule } from "./app/demo-data.app.ts";
import { demoDataEventing } from "./eventing/demo-data.pipeline.ts";
import { DemoDataTask } from "./tasks/demo-data.task.ts";

export const demoDataProcessModule = defineProcessModule("demo-data")
  .withApi(DemoDataModule)
  .withEventing(demoDataEventing)
  .withTasks(({ app }: { app: unknown }) => {
    if (!(app instanceof DemoDataModule))
      throw new TypeError("The demo-data task needs the DemoDataModule it installed");
    return [DemoDataTask.create({ seeds: app })];
  });
