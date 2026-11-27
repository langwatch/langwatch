import { LwqlRenderAccessConfigTask } from "@langwatch/analytics-process";

import type { TaskInput } from "./config.ts";

export async function lwqlRenderAccessConfig({
  environment,
  chain,
  signal,
}: TaskInput): Promise<void> {
  await LwqlRenderAccessConfigTask.create({
    source: environment,
    lookup: (id) => chain.fetch(id),
  }).run({ args: [], signal });
}
