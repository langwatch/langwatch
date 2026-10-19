import { dslWithoutHttpAgentSecrets } from "@langwatch/workflow-contract";
import { z } from "zod";

const dslHolderSchema = z.looseObject({ dsl: z.looseObject({}) });

/** A published version as the studio reads it: saved HTTP agents' credentials stay with them. */
export function publishedWorkflowWithoutSecrets<Workflow extends Readonly<Record<string, unknown>>>(
  workflow: Workflow,
): Workflow {
  const held = dslHolderSchema.safeParse(workflow);
  if (!held.success) return workflow;

  return { ...workflow, dsl: dslWithoutHttpAgentSecrets(held.data.dsl) };
}
