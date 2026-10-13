import { LwqlRenderAccessConfigTask } from "@langwatch/analytics-process";

import type { TaskInput } from "./config.ts";

export async function lwqlRenderAccessConfig({ environment, signal }: TaskInput): Promise<void> {
  await LwqlRenderAccessConfigTask.create({ source: environment }).run({ args: [], signal });
}
