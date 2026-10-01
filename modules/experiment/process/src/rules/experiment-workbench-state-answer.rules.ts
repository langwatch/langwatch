import type {
  WorkbenchStateView,
  workbenchStateAnswerSchema,
} from "@langwatch/experiment-contract";
import type { z } from "zod";

/** `GET /:slug/workbench-state`'s answer: `fields=version` leaves out the name and the setup. */
export function workbenchStateAnswer(options: {
  workbench: WorkbenchStateView;
  fields: string | undefined;
}): z.infer<typeof workbenchStateAnswerSchema> {
  const { workbench, fields } = options;
  const identity = {
    id: workbench.experimentId,
    slug: workbench.slug,
    version: workbench.version,
    updatedAt: workbench.updatedAt.toISOString(),
  };

  if (fields === "version") return identity;

  return { ...identity, name: workbench.name, state: workbench.state };
}
