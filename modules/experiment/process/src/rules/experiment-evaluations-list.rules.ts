import { studioWorkflowSchema } from "@langwatch/workflow-contract";

/** The dataset a workflow's entry node draws from, when it names one. */
export const extractDatasetId = (dsl: unknown): string | undefined => {
  const parsed = studioWorkflowSchema.safeParse(dsl);
  if (!parsed.success) return undefined;
  const entry = parsed.data.nodes.find((node) => node.type === "entry");

  return (entry?.data as { dataset?: { id?: string } } | undefined)?.dataset?.id;
};

/** The most recently created run in a list, or undefined for an empty list. */
export function pickLatestRun<T extends { timestamps: { createdAt: number } }>(
  runs: readonly T[],
): T | undefined {
  return runs.slice().toSorted((a, b) => b.timestamps.createdAt - a.timestamps.createdAt)[0];
}
