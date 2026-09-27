// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { defineServerModule } from "@langwatch/kernel";

import { DemoDataApp } from "./app/demo-data.app.ts";
import { demoDataEventing } from "./eventing/demo-data.pipeline.ts";
import { DemoDataTask } from "./tasks/demo-data.task.ts";

export const demoDataServer = defineServerModule("demo-data")
  .withApp(DemoDataApp)
  .withEventing(demoDataEventing)
  .withTasks(({ app }: { app: unknown }) => {
    if (!(app instanceof DemoDataApp))
      throw new TypeError("The demo-data task needs the DemoDataApp it installed");
    return [DemoDataTask.create({ seeds: app })];
  });
